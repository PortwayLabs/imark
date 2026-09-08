"""Local HTTP + WebSocket server (standard library only) that serves the iMark
editor bundle, workspace resources and theme files to the browser and carries
the editor protocol over WebSockets.

Only 127.0.0.1 is bound. Everything that reveals file contents (editor pages,
WebSocket sessions, resource roots) requires the per-run random token that is
embedded in the URLs the plugin opens."""
import hmac
import http.server
import mimetypes
import os
import secrets
import socketserver
import threading
import time
import urllib.parse

from . import util, websocket

mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/json', '.map')
mimetypes.add_type('text/markdown', '.md')
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('font/woff', '.woff')
mimetypes.add_type('font/ttf', '.ttf')
mimetypes.add_type('image/avif', '.avif')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('image/svg+xml', '.svg')

CHUNK = 64 * 1024


class Hooks:
    """Callbacks the plugin provides; all are invoked on server threads."""

    def landing_html(self):
        return '<!DOCTYPE html><title>iMark</title><p>iMark server is running.</p>'

    def page_html(self, sid):  # pylint: disable=unused-argument
        return None

    def ws_open(self, sid, file, ws):  # pylint: disable=unused-argument
        return None

    def ws_message(self, session, text):
        pass

    def ws_close(self, session, ws):
        pass

    def scheme_css(self):
        return ''


def safe_join(root, rel):
    """Join ``rel`` (URL path, '/' separated) onto ``root`` refusing traversal.
    Symlinks inside the root are allowed (Obsidian vaults use them)."""
    if not root:
        return None
    segments = [s for s in rel.split('/') if s not in ('', '.')]
    if any(s == '..' or '\\' in s or '\0' in s for s in segments):
        return None
    base = os.path.normpath(root)
    full = os.path.normpath(os.path.join(base, *segments)) if segments else base
    if full != base and not full.startswith(base + os.sep):
        return None
    return full


class IMarkHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, imark):
        self.imark = imark
        super().__init__(address, handler)


class Server:
    def __init__(self, hooks, web_root):
        self.hooks = hooks
        self.web_root = web_root
        self.token = secrets.token_urlsafe(24)
        self.host = '127.0.0.1'
        self.port = 0
        self._httpd = None
        self._thread = None
        self._roots = []
        self._root_index = {}
        self._lock = threading.Lock()
        self.sockets = set()
        self.started_at = None

    # ---- lifecycle -------------------------------------------------------------------------

    @property
    def running(self):
        return self._httpd is not None

    def start(self, host='127.0.0.1', port=0):
        if self._httpd is not None:
            return
        self.host = host or '127.0.0.1'
        try:
            httpd = IMarkHTTPServer((self.host, int(port or 0)), Handler, self)
        except OSError as exc:
            if not port:
                raise
            util.log('port %s unavailable (%s), using a free port', port, exc, force=True)
            httpd = IMarkHTTPServer((self.host, 0), Handler, self)
        self.port = httpd.server_address[1]
        self._httpd = httpd
        self.started_at = time.time()
        self._thread = threading.Thread(target=httpd.serve_forever, kwargs={'poll_interval': 0.5}, name='imark-http', daemon=True)
        self._thread.start()
        util.log('server listening on %s', self.base_url(), force=True)

    def stop(self):
        httpd = self._httpd
        if httpd is None:
            return
        self._httpd = None
        for ws in list(self.sockets):
            ws.send_close(1001, 'server shutting down')
            ws.close()
        self.sockets.clear()
        try:
            httpd.shutdown()
        finally:
            httpd.server_close()
        util.log('server stopped', force=True)

    # ---- URLs ----------------------------------------------------------------------------------

    def base_url(self):
        return 'http://%s:%d' % (self.host, self.port)

    def check_token(self, token):
        return bool(token) and hmac.compare_digest(str(token), self.token)

    def edit_url(self, sid, file_path):
        return '%s/edit/%s?t=%s&file=%s' % (self.base_url(), urllib.parse.quote(sid, safe=''), self.token, urllib.parse.quote(file_path or '', safe=''))

    def register_root(self, directory):
        """Allow files below ``directory`` to be served; returns the root index."""
        norm = os.path.normpath(os.path.abspath(directory))
        key = norm.lower() if util.platform() != 'linux' else norm
        with self._lock:
            idx = self._root_index.get(key)
            if idx is None:
                idx = len(self._roots)
                self._roots.append(norm)
                self._root_index[key] = idx
            return idx

    def root_dir(self, idx):
        with self._lock:
            return self._roots[idx] if 0 <= idx < len(self._roots) else None

    def root_url(self, idx):
        return '%s/r/%s/%d' % (self.base_url(), self.token, idx)

    def url_for_dir(self, directory):
        return self.root_url(self.register_root(directory))

    def url_for_file(self, path, stamp=True):
        url = '%s/%s' % (self.url_for_dir(os.path.dirname(path)), urllib.parse.quote(os.path.basename(path)))
        if stamp:
            try:
                url += '?v=%d' % int(os.stat(path).st_mtime * 1000)
            except OSError:
                pass
        return url

    def web_url(self, rel):
        return '%s/web/%s' % (self.base_url(), rel)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'iMark'
    sys_version = ''

    def log_message(self, fmt, *args):  # pylint: disable=arguments-differ
        util.log('http ' + fmt, *args)

    def do_GET(self):  # pylint: disable=invalid-name
        self._handle(head=False)

    def do_HEAD(self):  # pylint: disable=invalid-name
        self._handle(head=True)

    # ---- routing ---------------------------------------------------------------------------------

    def _handle(self, head):
        imark = self.server.imark
        hooks = imark.hooks
        try:
            url = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(url.path)
            query = urllib.parse.parse_qs(url.query)
            token = (query.get('t') or [''])[0]

            if path == '/':
                return self._send_text(hooks.landing_html(), 'text/html; charset=utf-8', head)
            if path == '/favicon.ico':
                return self._send_file(safe_join(imark.web_root, 'icons/imark.png'), head)
            if path.startswith('/web/'):
                return self._send_file(safe_join(imark.web_root, path[len('/web/'):]), head)
            if path == '/scheme.css':
                return self._send_text(hooks.scheme_css() or '', 'text/css; charset=utf-8', head, cache='no-store')
            if path.startswith('/edit/'):
                if not imark.check_token(token):
                    return self._send_error(403, 'invalid token')
                html = hooks.page_html(path[len('/edit/'):])
                if html is None:
                    return self._send_error(404, 'unknown document')
                return self._send_text(html, 'text/html; charset=utf-8', head, cache='no-store')
            if path.startswith('/ws/'):
                if not imark.check_token(token):
                    return self._send_error(403, 'invalid token')
                if head or 'websocket' not in (self.headers.get('Upgrade') or '').lower():
                    return self._send_error(400, 'websocket upgrade expected')
                return self._websocket(path[len('/ws/'):], (query.get('file') or [''])[0])
            if path.startswith('/r/'):
                parts = path[len('/r/'):].split('/', 2)
                if len(parts) < 3 or not imark.check_token(parts[0]):
                    return self._send_error(403, 'invalid token')
                try:
                    root = imark.root_dir(int(parts[1]))
                except ValueError:
                    root = None
                if root is None:
                    return self._send_error(404, 'unknown root')
                return self._send_file(safe_join(root, parts[2]), head, allow_range=True)
            return self._send_error(404, 'not found')
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:  # pylint: disable=broad-except
            util.log_exception('request %s' % self.path)
            try:
                self._send_error(500, 'internal error')
            except Exception:  # pylint: disable=broad-except
                self.close_connection = True

    # ---- responses ---------------------------------------------------------------------------------

    def _send_error(self, code, message):
        body = ('%d %s' % (code, message)).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, content_type, head, cache='no-store'):
        body = text.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', cache)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _send_file(self, path, head, allow_range=False):
        if not path or not os.path.isfile(path):
            return self._send_error(404, 'not found')
        try:
            st = os.stat(path)
        except OSError:
            return self._send_error(404, 'not found')
        etag = '"%x-%x"' % (int(st.st_mtime * 1000), st.st_size)
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            return None
        ctype, _ = mimetypes.guess_type(path)
        ctype = ctype or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/json', 'application/javascript', 'text/javascript'):
            ctype += '; charset=utf-8'
        start, end = 0, st.st_size - 1
        status = 200
        range_header = self.headers.get('Range') if allow_range else None
        if range_header and range_header.startswith('bytes='):
            spec = range_header[len('bytes='):].split(',')[0].strip()
            try:
                lo, hi = spec.split('-', 1)
                if lo:
                    start = int(lo)
                    end = int(hi) if hi else end
                elif hi:
                    start = max(0, st.st_size - int(hi))
                if start > end or start >= st.st_size:
                    raise ValueError
                end = min(end, st.st_size - 1)
                status = 206
            except ValueError:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % st.st_size)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
        length = end - start + 1
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'no-cache')
        if allow_range:
            self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, st.st_size))
        self.end_headers()
        if head:
            return None
        with open(path, 'rb') as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        return None

    # ---- websocket ---------------------------------------------------------------------------------

    def _websocket(self, sid, file_path):
        imark = self.server.imark
        key = self.headers.get('Sec-WebSocket-Key')
        if not key:
            return self._send_error(400, 'missing Sec-WebSocket-Key')
        self.send_response(101, 'Switching Protocols')
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', websocket.accept_key(key))
        self.end_headers()
        self.close_connection = True

        ws = websocket.WebSocket(self.connection, self.rfile, self.wfile)
        imark.sockets.add(ws)
        session = None
        try:
            session = imark.hooks.ws_open(sid, file_path, ws)
        except Exception:  # pylint: disable=broad-except
            util.log_exception('ws_open(%s)' % sid)
        if session is None:
            ws.send_close(1008, 'unknown document')
            ws.close()
            imark.sockets.discard(ws)
            return None
        try:
            for text in ws.messages():
                try:
                    imark.hooks.ws_message(session, text)
                except Exception:  # pylint: disable=broad-except
                    util.log_exception('ws_message')
        finally:
            imark.sockets.discard(ws)
            ws.close()
            try:
                imark.hooks.ws_close(session, ws)
            except Exception:  # pylint: disable=broad-except
                util.log_exception('ws_close')
        return None
