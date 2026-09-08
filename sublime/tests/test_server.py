import http.client
import json
import os
import socket
import struct
import tempfile
import threading
import unittest

import _env  # noqa: F401  pylint: disable=unused-import

from iMark.imark_lib import server as server_mod  # noqa: E402
from iMark.imark_lib import websocket  # noqa: E402


class EchoHooks(server_mod.Hooks):
    def __init__(self):
        self.received = []
        self.closed = threading.Event()

    def page_html(self, sid):
        return '<html>%s</html>' % sid if sid != 'missing' else None

    def ws_open(self, sid, file, ws):
        if sid == 'reject':
            return None
        ws.send_text(json.dumps({'type': 'hello', 'sid': sid, 'file': file}))
        return {'sid': sid, 'ws': ws}

    def ws_message(self, session, text):
        self.received.append(text)
        session['ws'].send_text('echo:' + text)

    def ws_close(self, session, ws):
        self.closed.set()

    def scheme_css(self):
        return 'body{--x:1}'


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.web = tempfile.mkdtemp(prefix='imark-web-')
        os.makedirs(os.path.join(cls.web, 'webview'))
        with open(os.path.join(cls.web, 'webview', 'main.js'), 'w', encoding='utf-8') as fh:
            fh.write('console.log(1)')
        cls.vault = tempfile.mkdtemp(prefix='imark-vault-')
        os.makedirs(os.path.join(cls.vault, 'sub'))
        with open(os.path.join(cls.vault, 'sub', 'note.md'), 'w', encoding='utf-8') as fh:
            fh.write('0123456789')
        with open(os.path.join(os.path.dirname(cls.vault), 'secret.txt'), 'w', encoding='utf-8') as fh:
            fh.write('secret')
        cls.hooks = EchoHooks()
        cls.server = server_mod.Server(cls.hooks, cls.web)
        cls.server.start('127.0.0.1', 0)

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()

    def get(self, path, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.port, timeout=5)
        conn.request('GET', path, headers=headers or {})
        res = conn.getresponse()
        body = res.read()
        conn.close()
        return res, body

    def test_safe_join(self):
        root = self.vault
        self.assertEqual(server_mod.safe_join(root, 'sub/note.md'), os.path.join(root, 'sub', 'note.md'))
        self.assertIsNone(server_mod.safe_join(root, '../secret.txt'))
        self.assertIsNone(server_mod.safe_join(root, 'sub/../../secret.txt'))
        self.assertIsNone(server_mod.safe_join(root, 'a\\..\\b'))
        self.assertEqual(server_mod.safe_join(root, ''), os.path.normpath(root))

    def test_static_and_landing(self):
        res, body = self.get('/')
        self.assertEqual(res.status, 200)
        self.assertIn(b'iMark', body)
        res, body = self.get('/web/webview/main.js')
        self.assertEqual(res.status, 200)
        self.assertEqual(body, b'console.log(1)')
        self.assertIn('javascript', res.getheader('Content-Type'))
        etag = res.getheader('ETag')
        res, _ = self.get('/web/webview/main.js', {'If-None-Match': etag})
        self.assertEqual(res.status, 304)
        res, _ = self.get('/web/../secret.txt')
        self.assertEqual(res.status, 404)
        res, body = self.get('/scheme.css')
        self.assertEqual((res.status, body), (200, b'body{--x:1}'))

    def test_edit_page_requires_token(self):
        res, _ = self.get('/edit/v1')
        self.assertEqual(res.status, 403)
        res, body = self.get('/edit/v1?t=' + self.server.token)
        self.assertEqual((res.status, body), (200, b'<html>v1</html>'))
        res, _ = self.get('/edit/missing?t=' + self.server.token)
        self.assertEqual(res.status, 404)

    def test_resource_roots(self):
        idx = self.server.register_root(self.vault)
        self.assertEqual(self.server.register_root(self.vault + os.sep), idx)
        url = self.server.url_for_file(os.path.join(self.vault, 'sub', 'note.md'))
        self.assertTrue(url.startswith(self.server.base_url() + '/r/' + self.server.token + '/'))
        path = url[len(self.server.base_url()):]
        res, body = self.get(path)
        self.assertEqual((res.status, body), (200, b'0123456789'))
        self.assertEqual(res.getheader('Accept-Ranges'), 'bytes')
        res, body = self.get(path, {'Range': 'bytes=2-4'})
        self.assertEqual((res.status, body), (206, b'234'))
        self.assertEqual(res.getheader('Content-Range'), 'bytes 2-4/10')
        res, body = self.get(path, {'Range': 'bytes=-3'})
        self.assertEqual((res.status, body), (206, b'789'))
        res, _ = self.get('/r/%s/%d/../secret.txt' % (self.server.token, idx))
        self.assertEqual(res.status, 404)
        res, _ = self.get('/r/wrongtoken/%d/sub/note.md' % idx)
        self.assertEqual(res.status, 403)
        res, _ = self.get('/r/%s/999/sub/note.md' % self.server.token)
        self.assertEqual(res.status, 404)

    def _ws_connect(self, sid, extra=''):
        sock = socket.create_connection(('127.0.0.1', self.server.port), timeout=5)
        key = 'dGhlIHNhbXBsZSBub25jZQ=='
        req = ('GET /ws/%s?t=%s%s HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n') % (sid, self.server.token, extra, key)
        sock.sendall(req.encode('ascii'))
        rfile = sock.makefile('rb')
        status = rfile.readline()
        headers = {}
        while True:
            line = rfile.readline()
            if line in (b'\r\n', b''):
                break
            k, v = line.decode('latin-1').split(':', 1)
            headers[k.strip().lower()] = v.strip()
        return sock, rfile, status, headers

    def test_websocket_roundtrip(self):
        sock, rfile, status, headers = self._ws_connect('v7', '&file=%2Ftmp%2Fa.md')
        self.assertIn(b'101', status)
        self.assertEqual(headers['sec-websocket-accept'], 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
        fin, opcode, payload = websocket.read_frame(rfile)
        self.assertEqual((fin, opcode), (True, websocket.OP_TEXT))
        self.assertEqual(json.loads(payload.decode('utf-8')), {'type': 'hello', 'sid': 'v7', 'file': '/tmp/a.md'})
        # client → server (masked) text frame
        payload = b'{"type":"ready"}'
        mask = b'\x01\x02\x03\x04'
        sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + websocket.unmask(payload, mask))
        _, _, echoed = websocket.read_frame(rfile)
        self.assertEqual(echoed, b'echo:{"type":"ready"}')
        self.assertEqual(self.hooks.received, ['{"type":"ready"}'])
        # close handshake
        sock.sendall(bytes([0x88, 0x82]) + mask + websocket.unmask(struct.pack('!H', 1000), mask))
        _, opcode, _ = websocket.read_frame(rfile)
        self.assertEqual(opcode, websocket.OP_CLOSE)
        self.assertTrue(self.hooks.closed.wait(5))
        sock.close()

    def test_websocket_rejected_session(self):
        _sock, rfile, status, _ = self._ws_connect('reject')
        self.assertIn(b'101', status)
        _, opcode, payload = websocket.read_frame(rfile)
        self.assertEqual(opcode, websocket.OP_CLOSE)
        self.assertEqual(struct.unpack('!H', payload[:2])[0], 1008)

    def test_websocket_requires_token(self):
        res, _ = self.get('/ws/v1', {'Upgrade': 'websocket'})
        self.assertEqual(res.status, 403)


if __name__ == '__main__':
    unittest.main()
