"""Document sessions: keep a Sublime Text view and the browser-hosted iMark
editor in sync with the same protocol the VS Code extension uses.

The browser sends incremental ``edit {gen, changes}`` messages; the session
keeps a shadow copy of the text it believes the editor holds and turns the
changes into buffer edits. Edits made in Sublime Text are detected by comparing
the buffer with the shadow and pushed as a full ``update`` (the editor diffs).
All Sublime API access happens on the main thread."""
import base64
import datetime
import json
import os
import re
import urllib.parse

import sublime

from . import browser, scheme, server as server_mod, textutil, util
from .files import FileIndex, open_views_text
from .links import MD_EXT, parse_target
from .themes import DEFAULT_THEME, ThemeLibrary, ThemeWatcher

MODE_LABELS = {'live': 'Live Preview', 'source': 'Source', 'reading': 'Reading'}
OPEN_EXTERNALLY = frozenset({'.pdf', '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.mp4', '.webm', '.mov', '.mkv'})
MIME_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
}
# Clipboard-style names that carry no information ("image", "image 2", "blob", "screenshot 2024-01-01",
# "Pasted image 20240101", empty). Mirrors src/shared/attachmentName.ts - keep both in sync.
_GENERIC_NAME = re.compile(r'^(?:image|blob|clipboard|screenshot|pasted[ _-]?image)?(?:[ _.-]*\d+)*[ _.-]*$', re.IGNORECASE)
_SCHEME = re.compile(r'^[a-z][a-z0-9+.-]*:', re.IGNORECASE)


class Session:
    def __init__(self, view):
        self.view = view
        self.sid = 'v%d' % view.id()
        self.file = view.file_name()
        self.shadow = ''
        self.astral = False
        self.gen = 1
        self.ready = False
        self.mode = str(util.setting('editor.default_mode', 'live') or 'live')
        self.sockets = set()
        self.stats = None
        self.roots = []
        self._sync_serial = 0

    @property
    def connected(self):
        return bool(self.sockets)

    def set_shadow(self, text):
        self.shadow = text
        self.astral = textutil.has_astral(text)

    def send(self, msg):
        if not self.sockets:
            return
        data = json.dumps(msg, ensure_ascii=False)
        for ws in list(self.sockets):
            try:
                ws.send_text(data)
            except Exception:  # pylint: disable=broad-except
                self.sockets.discard(ws)


class Hooks(server_mod.Hooks):
    """Server callbacks (server threads) → manager (main thread)."""

    def __init__(self, manager):
        self.manager = manager

    def landing_html(self):
        # Runs on a server thread: gather view state on the main thread.
        try:
            names = util.call_on_main(self.manager.open_document_names, timeout=3.0)
        except Exception:  # pylint: disable=broad-except
            names = []
        return self.manager.landing_html(names)

    def page_html(self, sid):
        return self.manager.page_html(sid)

    def ws_open(self, sid, file, ws):
        return util.call_on_main(self.manager.attach, sid, file, ws)

    def ws_message(self, session, text):
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if isinstance(msg, dict) and isinstance(msg.get('type'), str):
            util.main_thread(self.manager.handle, session, msg)

    def ws_close(self, session, ws):
        util.main_thread(self.manager.detach, session, ws)

    def scheme_css(self):
        try:
            return util.call_on_main(self.manager.scheme_css)
        except Exception:  # pylint: disable=broad-except
            return ''


class SyncManager:
    def __init__(self):
        self.sessions = {}
        self.by_view = {}
        self.server = None
        user = util.user_dir()
        self.themes = ThemeLibrary(os.path.join(util.web_root(), 'themes'), os.path.join(user, 'themes'), os.path.join(user, 'snippets'))
        self.files = FileIndex()
        self.watcher = ThemeWatcher(self.broadcast_theme)
        self._scheme_name = None
        self._last_view = None
        self._settings_debounce = util.Debouncer(self._on_settings_changed, 150)

    # ---- server ------------------------------------------------------------------------------

    def ensure_server(self):
        if self.server is None or not self.server.running:
            self.server = server_mod.Server(Hooks(self), util.web_root())
            self.server.start(str(util.setting('server.host', '127.0.0.1') or '127.0.0.1'), int(util.setting('server.port', 0) or 0))
        return self.server

    def stop_server(self):
        for session in list(self.sessions.values()):
            session.send({'type': 'closed', 'reason': 'The iMark server was stopped in Sublime Text.'})
        if self.server is not None:
            self.server.stop()
        for session in list(self.sessions.values()):
            session.sockets.clear()
            self.update_status(session)
        self.watcher.stop()

    def shutdown(self):
        self.stop_server()
        self.sessions.clear()
        self.by_view.clear()

    # ---- sessions -------------------------------------------------------------------------------

    def session_for(self, view, create=False):
        session = self.by_view.get(view.id())
        if session is None and create:
            session = Session(view)
            self.sessions[session.sid] = session
            self.by_view[view.id()] = session
        return session

    def open(self, view, open_browser=True):
        """Open (or reuse) the editor for ``view``; returns the URL."""
        if view is None or not view.is_valid():
            return None
        if not view.file_name():
            sublime.status_message('iMark: save the file first')
            return None
        if not util.is_markdown_view(view):
            sublime.status_message('iMark: not a Markdown file')
            return None
        session = self.session_for(view, create=True)
        session.file = view.file_name()
        self._last_view = view
        server = self.ensure_server()
        url = server.edit_url(session.sid, session.file)
        if open_browser:
            browser.open_url(url)
            sublime.status_message('iMark: opening %s' % os.path.basename(session.file))
        return url

    def attach(self, sid, file, ws):
        """(main thread) Bind a WebSocket to the session for ``sid`` / ``file``."""
        session = self.sessions.get(sid)
        if session is not None and (not session.view.is_valid() or (file and session.file and os.path.normpath(file) != os.path.normpath(session.file))):
            session = None
        if session is None and file:
            view = None
            for window in sublime.windows():
                view = window.find_open_file(file)
                if view is not None:
                    break
            if view is None and os.path.isfile(file) and util.setting('reopen_closed_files', True):
                window = sublime.active_window()
                if window is not None:
                    view = window.open_file(file)
            if view is not None:
                session = self.session_for(view, create=True)
        if session is None:
            return None
        session.sockets.add(ws)
        self.update_status(session)
        return session

    def detach(self, session, ws):
        session.sockets.discard(ws)
        self.update_status(session)

    def post_to_view(self, view, msg):
        session = self.by_view.get(view.id()) if view is not None else None
        if session is None or not session.connected:
            return False
        session.send(msg)
        return True

    # ---- incoming ---------------------------------------------------------------------------------

    def handle(self, session, msg):
        kind = msg.get('type')
        try:
            if kind == 'ready':
                self.send_init(session)
            elif kind == 'resync':
                self._resync(session)
            elif kind == 'edit':
                self._apply_edit(session, msg.get('gen'), msg.get('changes') or [])
            elif kind == 'openLink':
                self._open_link(session, str(msg.get('href') or ''))
            elif kind == 'openWikilink':
                self._open_wikilink(session, str(msg.get('target') or ''))
            elif kind == 'searchTag':
                self._search_tag(session, str(msg.get('tag') or ''))
            elif kind == 'readFile':
                self._read_file(session, msg.get('id'), str(msg.get('target') or ''))
            elif kind == 'saveAttachment':
                self._save_attachment(session, msg.get('id'), str(msg.get('name') or ''), str(msg.get('mime') or ''), str(msg.get('data') or ''))
            elif kind == 'modeChanged':
                session.mode = str(msg.get('mode') or session.mode)
                self.update_status(session)
            elif kind == 'stats':
                session.stats = (int(msg.get('words') or 0), int(msg.get('characters') or 0))
                self.update_status(session)
            elif kind == 'notify':
                self._notify(str(msg.get('level') or 'info'), str(msg.get('message') or ''))
            elif kind == 'command':
                self._run_command(session, str(msg.get('command') or ''))
            elif kind == 'save':
                self._save(session)
        except Exception:  # pylint: disable=broad-except
            util.log_exception('handle %s' % kind)

    def send_init(self, session):
        view = session.view
        if not view.is_valid():
            return
        if view.is_loading():
            sublime.set_timeout(lambda: self.send_init(session), 40)
            return
        roots = self.files.roots_for(view)
        index = self.files

        def scan():
            try:
                files = index.files_for_roots(roots)
            except Exception:  # pylint: disable=broad-except
                util.log_exception('file index')
                files = []
            util.main_thread(self._finish_init, session, roots, files)

        sublime.set_timeout_async(scan, 0)

    def _finish_init(self, session, roots, files):
        view = session.view
        if not view.is_valid() or not session.connected:
            return
        session.file = view.file_name()
        session.roots = roots
        session.set_shadow(util.view_text(view))
        session.gen += 1
        session.ready = True
        server = self.ensure_server()
        init = {
            'type': 'init',
            'text': session.shadow,
            'gen': session.gen,
            'doc': self.doc_info(session, roots),
            'roots': [{'fsPath': util.to_posix(r), 'webviewUri': server.url_for_dir(r)} for r in roots],
            'files': files,
            'config': self.config_for(view),
            'theme': self.theme_info(),
        }
        session.send({'type': 'hostTheme', 'dark': self.is_dark(view)})
        session.send(init)
        self.update_status(session)
        util.log('init %s (%d files, %d chars)', session.sid, len(files), len(session.shadow))

    def _resync(self, session):
        view = session.view
        if not view.is_valid():
            return
        if not session.ready:
            self.send_init(session)
            return
        session.set_shadow(util.view_text(view))
        session.gen += 1
        session.send({'type': 'update', 'text': session.shadow, 'gen': session.gen})

    def _apply_edit(self, session, gen, changes):
        if gen != session.gen or not changes:
            return
        view = session.view
        if not view.is_valid():
            return
        if view.is_read_only():
            self._resync(session)
            sublime.status_message('iMark: file is read-only')
            return
        before = session.shadow
        if util.view_text(view) != before:
            self._resync(session)
            return
        try:
            converted = textutil.convert_changes(before, changes, session.astral)
            after = textutil.apply_changes(before, converted)
        except (ValueError, KeyError, TypeError):
            self._resync(session)
            return
        session.set_shadow(after)
        view.run_command('imark_apply_changes', {'changes': [{'from': s, 'to': e, 'insert': ins} for s, e, ins in converted]})
        if util.view_text(view) != session.shadow:
            self._resync(session)

    # ---- Sublime events (main thread) -----------------------------------------------------------------

    def on_view_modified(self, view):
        session = self.by_view.get(view.id())
        if session is None or not session.ready or not session.connected:
            return
        session._sync_serial += 1  # pylint: disable=protected-access
        serial = session._sync_serial  # pylint: disable=protected-access

        def fire():
            if serial == session._sync_serial:  # pylint: disable=protected-access
                self._sync_from_view(session)

        sublime.set_timeout(fire, 15)

    def _sync_from_view(self, session):
        view = session.view
        if not view.is_valid() or not session.connected:
            return
        text = util.view_text(view)
        if text == session.shadow:
            return
        session.set_shadow(text)
        session.gen += 1
        session.send({'type': 'update', 'text': text, 'gen': session.gen})

    def on_view_closed(self, view):
        session = self.by_view.pop(view.id(), None)
        if session is None:
            return
        self.sessions.pop(session.sid, None)
        session.send({'type': 'closed', 'reason': 'The document was closed in Sublime Text.'})
        for ws in list(session.sockets):
            ws.close()
        session.sockets.clear()

    def on_view_saved(self, view):
        session = self.by_view.get(view.id())
        path = view.file_name()
        if session is not None and path and session.file != path:
            session.file = path
            session.roots = self.files.roots_for(view)
            session.send({'type': 'documentInfo', 'doc': self.doc_info(session, session.roots)})
            self.files.invalidate()
            self.broadcast_files()
        elif path and not self.files.contains(path):
            self.files.invalidate(path)
            self.broadcast_files()

    def on_view_activated(self, view):
        if view is None or not view.is_valid():
            return
        if view.id() in self.by_view:
            self._last_view = view
        if not self.sessions:
            return
        try:
            name = view.settings().get('color_scheme')
        except Exception:  # pylint: disable=broad-except
            return
        if name and name != self._scheme_name:
            first = self._scheme_name is None
            self._scheme_name = name
            if not first:
                self.broadcast_theme()

    def on_settings_changed(self):
        self._settings_debounce()

    def _on_settings_changed(self):
        self.broadcast_config()
        self.broadcast_theme()

    # ---- outgoing broadcasts ------------------------------------------------------------------------------

    def _live_sessions(self):
        return [s for s in self.sessions.values() if s.ready and s.connected and s.view.is_valid()]

    def broadcast_config(self):
        for s in self._live_sessions():
            s.send({'type': 'config', 'config': self.config_for(s.view)})

    def broadcast_theme(self):
        live = self._live_sessions()
        if not live:
            return
        info = self.theme_info()
        for s in live:
            s.send({'type': 'hostTheme', 'dark': self.is_dark(s.view)})
            s.send({'type': 'theme', 'theme': info})

    def broadcast_files(self):
        live = self._live_sessions()
        if not live:
            return

        def scan():
            payload = []
            for s in live:
                try:
                    payload.append((s, self.files.files_for_roots(s.roots)))
                except Exception:  # pylint: disable=broad-except
                    util.log_exception('file index')
            util.main_thread(lambda: [s.send({'type': 'fileIndex', 'files': files}) for s, files in payload if s.connected])

        sublime.set_timeout_async(scan, 0)

    # ---- message handlers ----------------------------------------------------------------------------------

    def _open_link(self, session, href):
        trimmed = href.strip()
        if not trimmed or trimmed.startswith('#'):
            return
        if _SCHEME.match(trimmed) and not trimmed.lower().startswith('file:'):
            util.open_external(trimmed)
            return
        if trimmed.lower().startswith('file:'):
            target = urllib.parse.unquote(urllib.parse.urlsplit(trimmed).path)
            if os.name == 'nt' and re.match(r'^/[A-Za-z]:', target):
                target = target[1:]
        else:
            p = trimmed.split('#')[0]
            try:
                p = urllib.parse.unquote(p)
            except ValueError:
                pass
            target = p if os.path.isabs(p) else os.path.normpath(os.path.join(os.path.dirname(session.file), p))
        self._open_file(session, target)

    def _open_wikilink(self, session, raw):
        target = parse_target(raw)
        if not target.path:
            return
        roots = session.roots or self.files.roots_for(session.view)
        path = self.files.resolve_in(session.file, roots, target.path)
        if not path:
            path = self.files.new_note_path(session.file, roots, target.path)
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                if not os.path.exists(path):
                    with open(path, 'w', encoding='utf-8'):
                        pass
            except OSError:
                util.log_exception('create note %s' % path)
                sublime.status_message('iMark: could not create %s' % path)
                return
            self.files.invalidate()
            self.broadcast_files()
        self._open_file(session, path)

    def _open_file(self, session, path):
        if not os.path.exists(path):
            sublime.status_message('iMark: not found: %s' % path)
            session.send({'type': 'toast', 'message': 'Not found: %s' % os.path.basename(path)})
            return
        ext = os.path.splitext(path)[1].lower()
        if ext in OPEN_EXTERNALLY:
            util.open_external(util.file_url(path))
            return
        window = session.view.window() or sublime.active_window()
        if window is None:
            return
        view = window.open_file(path)
        if MD_EXT.search(path) and util.setting('follow_links_in_browser', True):
            def when_loaded():
                if not view.is_valid():
                    return
                if view.is_loading():
                    sublime.set_timeout(when_loaded, 30)
                    return
                url = self.open(view, open_browser=False)
                if url:
                    session.send({'type': 'navigate', 'url': url})

            when_loaded()
        else:
            window.focus_view(view)
            util.activate_sublime()

    def _search_tag(self, session, tag):
        self.search_tag(session.view, tag)

    def search_tag(self, view, tag):
        """Open Find in Files pre-filled with ``#tag`` (the panel takes the selection)."""
        window = view.window() or sublime.active_window()
        if window is None or not tag:
            return
        window.focus_view(view)
        needle = '#' + tag
        region = view.find(re.escape(needle), 0, sublime.LITERAL) if hasattr(sublime, 'LITERAL') else view.find(re.escape(needle), 0)
        saved = list(view.sel())
        if region is not None and region.a >= 0 and not region.empty():
            view.sel().clear()
            view.sel().add(region)
        window.run_command('show_panel', {'panel': 'find_in_files', 'where': '<project>'})

        def restore():
            if view.is_valid() and saved:
                view.sel().clear()
                for r in saved:
                    view.sel().add(r)

        sublime.set_timeout(restore, 150)
        util.activate_sublime()

    def _read_file(self, session, req_id, target):
        text = None
        roots = session.roots or self.files.roots_for(session.view)
        path = self.files.resolve_in(session.file, roots, target)
        if path and MD_EXT.search(path):
            text = open_views_text(path)
            if text is None:
                try:
                    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                        text = fh.read()
                except OSError:
                    text = None
        session.send({'type': 'fileContent', 'id': req_id, 'text': text})

    def _save_attachment(self, session, req_id, name, mime, data):
        try:
            folder = str(util.setting('attachments.folder', 'assets') or '')
            saved = save_attachment(session.file, folder, name, mime, data)
            session.send({'type': 'attachmentSaved', 'id': req_id, 'relPath': saved['relPath'], 'name': saved['name']})
            self.files.invalidate(saved['path'])
            self.broadcast_files()
        except Exception as exc:  # pylint: disable=broad-except
            util.log_exception('saveAttachment')
            session.send({'type': 'attachmentSaved', 'id': req_id, 'relPath': '', 'name': '', 'error': str(exc)})

    def _notify(self, level, message):
        if level == 'error':
            sublime.error_message('iMark: %s' % message)
        else:
            sublime.status_message('iMark: %s' % message)
            util.log('%s: %s', level, message)

    def _run_command(self, session, command):
        window = session.view.window() or sublime.active_window()
        if command == 'openSource':
            if window is not None:
                window.focus_view(session.view)
            util.activate_sublime()
        elif command in ('selectTheme', 'manageThemes'):
            if window is not None:
                window.run_command('imark_select_theme')
            util.activate_sublime()
        elif command == 'toggleReadableLineWidth':
            util.set_setting('editor.readable_line_width', not bool(util.setting('editor.readable_line_width', True)))

    def _save(self, session):
        view = session.view
        if not view.is_valid():
            return
        if view.is_dirty():
            view.run_command('save')
            session.send({'type': 'toast', 'message': 'Saved %s' % os.path.basename(view.file_name() or '')})
        else:
            session.send({'type': 'toast', 'message': 'No changes to save'})

    # ---- payload builders ---------------------------------------------------------------------------------------

    def config_for(self, view):
        get = util.setting
        vs = view.settings()
        layout = str(get('editor.table_layout', 'fit') or 'fit')
        mode = str(get('editor.default_mode', 'live') or 'live')
        return {
            'mode': mode if mode in MODE_LABELS else 'live',
            'readableLineWidth': bool(get('editor.readable_line_width', True)),
            'showInlineTitle': bool(get('editor.show_inline_title', True)),
            'showHeader': bool(get('editor.show_header', True)),
            'fontSize': int(get('editor.font_size', 0) or 0),
            'lineNumbers': bool(get('editor.line_numbers', False)),
            'spellcheck': bool(get('editor.spellcheck', False)),
            'autoPairMarkdown': bool(get('editor.auto_pair_markdown', True)),
            'smartClickLinks': bool(get('editor.smart_click_links', True)),
            'wideTables': bool(get('editor.wide_tables', False)),
            'tableLayout': layout if layout in ('fit', 'natural') else 'fit',
            'tabSize': int(vs.get('tab_size', 4) or 4),
            'insertSpaces': bool(vs.get('translate_tabs_to_spaces', True)),
            'attachmentLinkStyle': 'wikilink' if get('attachments.link_style', 'markdown') == 'wikilink' else 'markdown',
            'platform': util.platform(),
        }

    def doc_info(self, session, roots):
        root, rel = self.files.doc_info_for(session.file, roots)
        return {
            'fsPath': util.to_posix(session.file),
            'title': MD_EXT.sub('', os.path.basename(session.file)),
            'root': root,
            'path': rel,
        }

    def theme_info(self):
        resolved = self.themes.resolve()
        self.watcher.set_paths(resolved['css_paths'])
        return self.themes.to_theme_info(self.ensure_server(), resolved)

    def is_dark(self, view):
        mode = str(util.setting('theme.mode', 'auto') or 'auto')
        if mode == 'dark':
            return True
        if mode == 'light':
            return False
        return scheme.view_is_dark(view)

    def scheme_css(self):
        view = self._last_view if self._last_view is not None and self._last_view.is_valid() else None
        if view is None:
            window = sublime.active_window()
            view = window.active_view() if window is not None else None
        return scheme.scheme_css(view)

    def update_status(self, session):
        view = session.view
        if not view.is_valid():
            return
        if not session.connected:
            view.erase_status('imark')
            return
        text = 'iMark: %s' % MODE_LABELS.get(session.mode, session.mode)
        if session.stats:
            text += ' · %d words, %d characters' % session.stats
        view.set_status('imark', text)

    # ---- HTML ----------------------------------------------------------------------------------------------------------

    def page_html(self, sid):  # pylint: disable=unused-argument
        server = self.server
        if server is None:
            return None
        base = server.base_url()
        ws = base.replace('http://', 'ws://', 1)
        csp = '; '.join([
            "default-src 'none'",
            "img-src 'self' https: http: data: blob:",
            "media-src 'self' https: http: data: blob:",
            "style-src 'self' 'unsafe-inline' https: http:",
            "font-src 'self' https: http: data:",
            "script-src 'self'",
            "connect-src 'self' %s https:" % ws,
            "frame-src 'self' https:",
        ])
        return (
            '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            '<meta http-equiv="Content-Security-Policy" content="%s">\n'
            '<title>iMark</title>\n'
            '<link rel="icon" href="/web/icons/imark.png">\n'
            '<link rel="stylesheet" href="/web/css/imark-guard.css" id="imark-guard">\n'
            '<link rel="stylesheet" href="/web/webview/katex/katex.min.css">\n'
            '<link rel="stylesheet" href="/web/css/obsidian-vars.css">\n'
            '<link rel="stylesheet" href="/web/css/obsidian-base.css">\n'
            '</head>\n<body class="imark-body">\n'
            '<script src="/web/sublime/bridge.js"></script>\n'
            '<script type="module" src="/web/webview/main.js"></script>\n'
            '</body>\n</html>\n' % csp
        )

    def open_document_names(self):
        """(main thread) File names of the documents that have a session."""
        return sorted(os.path.basename(s.file or '') for s in self.sessions.values() if s.view.is_valid())

    def landing_html(self, names=()):
        items = ''.join('<li>%s</li>' % html_escape(n) for n in names) or '<li><em>none</em></li>'
        return (
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>iMark for Sublime Text</title>'
            '<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:40em;margin:4em auto;padding:0 1em;color:#222}'
            '@media(prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}}code{background:rgba(127,127,127,.2);padding:.1em .3em;border-radius:3px}</style>'
            '</head><body><h1>iMark for Sublime Text</h1><p>The iMark server is running (v%s). Open a Markdown file in Sublime Text and run '
            '<code>iMark: Open in iMark</code> from the command palette; the editor opens in your browser.</p>'
            '<p>Open documents:</p><ul>%s</ul></body></html>' % (html_escape(util.package_version()), items)
        )


def html_escape(text):
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def save_attachment(doc_path, folder, original_name, mime, data_b64):
    """Store a pasted / dropped image next to the note (port of attachments.ts)."""
    doc_dir = os.path.dirname(doc_path)
    target_dir = os.path.normpath(os.path.join(doc_dir, util.expand_user_path(folder))) if folder else doc_dir
    os.makedirs(target_dir, exist_ok=True)
    base_name = os.path.basename(original_name or '')
    dot = base_name.rfind('.')
    # Unlike splitext, a leading-dot-only name (".png") is an extension with an empty stem.
    stem, ext = (base_name, '') if dot < 0 else (base_name[:dot], base_name[dot + 1:].lower())
    ext = ext or MIME_EXT.get(mime, 'png')
    generic = not original_name or bool(_GENERIC_NAME.match(stem.strip()))
    base = 'Pasted image %s' % datetime.datetime.now().strftime('%Y%m%d%H%M%S') if generic else stem
    name = '%s.%s' % (base, ext)
    path = os.path.join(target_dir, name)
    i = 1
    while os.path.exists(path) and i < 1000:
        name = '%s %d.%s' % (base, i, ext)
        path = os.path.join(target_dir, name)
        i += 1
    with open(path, 'wb') as fh:
        fh.write(base64.b64decode(data_b64))
    return {'relPath': util.to_posix(os.path.relpath(path, doc_dir)), 'name': name, 'path': path}
