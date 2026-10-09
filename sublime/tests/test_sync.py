"""End-to-end session tests against the fake Sublime API: init, browser edits
(UTF-16 offsets), Sublime edits, resync, links, attachments, close."""
import base64
import json
import os
import unittest

import _env  # pylint: disable=unused-import

import sublime  # noqa: E402
import iMark.imark as plugin  # noqa: E402
from iMark.imark_lib import util  # noqa: E402


class FakeWS:
    def __init__(self):
        self.sent = []
        self.closed = False

    def send_text(self, text):
        self.sent.append(json.loads(text))

    def close(self):
        self.closed = True

    def send_close(self, *_args):
        pass

    def of(self, kind):
        return [m for m in self.sent if m['type'] == kind]


class SyncTest(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        plugin.plugin_loaded()
        self.manager = plugin.manager
        self.vault = _env.make_vault()
        self.window = sublime.Window(folders=[self.vault])
        self.note = os.path.join(self.vault, 'Notes', 'Alpha.md')
        self.view = self.window.open_file(self.note)
        self.ws = FakeWS()

    def tearDown(self):
        plugin.plugin_unloaded()

    def connect(self, view=None, ws=None):
        view = view or self.view
        ws = ws or self.ws
        url = self.manager.open(view, open_browser=False)
        self.assertTrue(url.startswith('http://127.0.0.1:'))
        session = self.manager.attach('v%d' % view.id(), view.file_name(), ws)
        self.assertIsNotNone(session)
        self.manager.handle(session, {'type': 'ready'})
        self.assertTrue(sublime.pump_until(lambda: ws.of('init'), timeout=5), 'init not sent')
        return session, ws.of('init')[0]

    def test_init_payload(self):
        session, init = self.connect()
        self.assertEqual(init['text'], util.view_text(self.view))
        self.assertEqual(init['doc']['title'], 'Alpha')
        self.assertEqual(init['doc']['path'], 'Notes/Alpha.md')
        self.assertEqual(init['doc']['root'], 0)
        self.assertEqual(init['roots'][0]['fsPath'], util.to_posix(self.vault))
        self.assertTrue(init['roots'][0]['webviewUri'].startswith(self.manager.server.base_url() + '/r/'))
        paths = sorted(f['path'] for f in init['files'])
        self.assertEqual(paths, ['Notes/Alpha.md', 'Notes/sub/Beta.md', 'Other/Beta.md', 'attachments/pic.png'])
        self.assertEqual(init['config']['platform'], util.platform())
        self.assertEqual(init['config']['tabSize'], 4)
        self.assertEqual(init['theme']['kind'], 'theme')
        self.assertTrue(self.ws.of('hostTheme'))
        self.assertTrue(session.ready)
        self.assertIn('iMark: Live Preview', self.view.get_status('imark'))
        # the page HTML is served for the session
        self.assertIn('/web/sublime/bridge.js', self.manager.page_html(session.sid))

    def test_browser_edit_with_astral_offsets(self):
        self.view.set_text('a😀b')
        session, init = self.connect()
        self.assertEqual(init['text'], 'a😀b')
        self.manager.handle(session, {'type': 'edit', 'gen': init['gen'], 'changes': [{'from': 3, 'to': 3, 'insert': 'X'}]})
        self.assertEqual(util.view_text(self.view), 'a😀Xb')
        sublime.pump(0.05)
        self.assertEqual(self.ws.of('update'), [], 'own edits must not echo back as updates')
        # stale generation is ignored
        self.manager.handle(session, {'type': 'edit', 'gen': init['gen'] - 1, 'changes': [{'from': 0, 'to': 0, 'insert': 'Z'}]})
        self.assertEqual(util.view_text(self.view), 'a😀Xb')
        # invalid offsets trigger a resync instead of corrupting the buffer
        self.manager.handle(session, {'type': 'edit', 'gen': session.gen, 'changes': [{'from': 2, 'to': 2, 'insert': 'Z'}]})
        self.assertEqual(util.view_text(self.view), 'a😀Xb')
        self.assertEqual(self.ws.of('update')[-1]['text'], 'a😀Xb')
        self.assertEqual(self.ws.of('update')[-1]['gen'], session.gen)

    def test_sublime_edit_pushes_update(self):
        session, init = self.connect()
        self.view.set_text(init['text'] + '\nTyped in Sublime\n')
        self.assertTrue(sublime.pump_until(lambda: self.ws.of('update'), timeout=2))
        update = self.ws.of('update')[-1]
        self.assertTrue(update['text'].endswith('Typed in Sublime\n'))
        self.assertEqual(update['gen'], session.gen)
        self.assertEqual(session.shadow, update['text'])

    def test_resync_and_read_only(self):
        session, _ = self.connect()
        self.manager.handle(session, {'type': 'resync'})
        self.assertEqual(self.ws.of('update')[-1]['text'], util.view_text(self.view))
        self.view.set_read_only(True)
        before = len(self.ws.of('update'))
        self.manager.handle(session, {'type': 'edit', 'gen': session.gen, 'changes': [{'from': 0, 'to': 0, 'insert': 'x'}]})
        self.assertEqual(len(self.ws.of('update')), before + 1)
        self.assertFalse(util.view_text(self.view).startswith('x'))

    def test_read_file_and_wikilinks(self):
        session, _ = self.connect()
        self.manager.handle(session, {'type': 'readFile', 'id': 7, 'target': 'Beta'})
        reply = self.ws.of('fileContent')[-1]
        self.assertEqual((reply['id'], reply['text']), (7, '# Other Beta\n'))
        self.manager.handle(session, {'type': 'readFile', 'id': 8, 'target': 'sub/Beta#Heading'})
        self.assertEqual(self.ws.of('fileContent')[-1]['text'], '# Beta\n\nBody\n')
        self.manager.handle(session, {'type': 'readFile', 'id': 9, 'target': 'pic.png'})
        self.assertIsNone(self.ws.of('fileContent')[-1]['text'])
        # following a wikilink opens the note in Sublime and navigates the browser
        self.manager.handle(session, {'type': 'openWikilink', 'target': 'Beta|alias'})
        self.assertTrue(sublime.pump_until(lambda: self.ws.of('navigate'), timeout=2))
        other = self.window.find_open_file(os.path.join(self.vault, 'Other', 'Beta.md'))
        self.assertIsNotNone(other)
        self.assertIn('/edit/v%d?' % other.id(), self.ws.of('navigate')[-1]['url'])
        # unresolved wikilink creates the note next to the document
        self.manager.handle(session, {'type': 'openWikilink', 'target': 'Brand New'})
        created = os.path.join(self.vault, 'Notes', 'Brand New.md')
        self.assertTrue(os.path.isfile(created))
        self.assertTrue(sublime.pump_until(lambda: self.ws.of('fileIndex'), timeout=2))
        self.assertIn('Notes/Brand New.md', [f['path'] for f in self.ws.of('fileIndex')[-1]['files']])

    def test_open_link_relative_and_external(self):
        session, _ = self.connect()
        self.manager.handle(session, {'type': 'openLink', 'href': 'sub/Beta.md#x'})
        self.assertIsNotNone(self.window.find_open_file(os.path.join(self.vault, 'Notes', 'sub', 'Beta.md')))
        self.manager.handle(session, {'type': 'openLink', 'href': 'https://example.com/'})
        self.assertIn(('open_url', {'url': 'https://example.com/'}), self.window.commands)
        self.manager.handle(session, {'type': 'openLink', 'href': 'missing.md'})
        self.assertTrue(self.ws.of('toast'))

    def test_save_attachment(self):
        session, _ = self.connect()
        data = base64.b64encode(b'\x89PNG fake').decode('ascii')
        self.manager.handle(session, {'type': 'saveAttachment', 'id': 3, 'name': 'image.png', 'mime': 'image/png', 'data': data})
        reply = self.ws.of('attachmentSaved')[-1]
        self.assertEqual(reply['id'], 3)
        self.assertTrue(reply['relPath'].startswith('assets/Pasted image '))
        self.assertTrue(os.path.isfile(os.path.join(self.vault, 'Notes', *reply['relPath'].split('/'))))
        # real file names are kept and de-duplicated; clipboard-style names get the timestamp name
        self.manager.handle(session, {'type': 'saveAttachment', 'id': 4, 'name': 'diagram.svg', 'mime': 'image/svg+xml', 'data': data})
        self.assertEqual(self.ws.of('attachmentSaved')[-1]['name'], 'diagram.svg')
        self.manager.handle(session, {'type': 'saveAttachment', 'id': 5, 'name': 'diagram.svg', 'mime': 'image/svg+xml', 'data': data})
        self.assertEqual(self.ws.of('attachmentSaved')[-1]['name'], 'diagram 1.svg')
        self.manager.handle(session, {'type': 'saveAttachment', 'id': 6, 'name': 'logo2.png', 'mime': 'image/png', 'data': data})
        self.assertEqual(self.ws.of('attachmentSaved')[-1]['name'], 'logo2.png')
        for generic in ('image 2.png', 'blob', 'Screenshot 2024-01-01.png', 'Pasted image 20240101120000.png', '.png', ''):
            self.manager.handle(session, {'type': 'saveAttachment', 'id': 7, 'name': generic, 'mime': 'image/png', 'data': data})
            self.assertTrue(self.ws.of('attachmentSaved')[-1]['name'].startswith('Pasted image '), generic)
            self.assertTrue(self.ws.of('attachmentSaved')[-1]['name'].endswith('.png'), generic)

    def test_save_stats_mode_and_close(self):
        session, _ = self.connect()
        self.manager.handle(session, {'type': 'modeChanged', 'mode': 'reading'})
        self.manager.handle(session, {'type': 'stats', 'words': 12, 'characters': 60})
        self.assertEqual(self.view.get_status('imark'), 'iMark: Reading · 12 words, 60 characters')
        self.view.set_text('changed')
        self.manager.handle(session, {'type': 'save'})
        with open(self.note, 'r', encoding='utf-8') as fh:
            self.assertEqual(fh.read(), 'changed')
        self.assertEqual(self.ws.of('toast')[-1]['message'], 'Saved Alpha.md')
        self.view.close()
        self.assertEqual(self.ws.of('closed')[-1]['reason'], 'The document was closed in Sublime Text.')
        self.assertTrue(self.ws.closed)
        self.assertNotIn(session.sid, self.manager.sessions)

    def test_settings_changes_broadcast(self):
        session, _ = self.connect()
        settings = sublime.load_settings(util.SETTINGS_FILE)
        settings.set('editor.readable_line_width', False)
        self.assertTrue(sublime.pump_until(lambda: self.ws.of('config'), timeout=2))
        self.assertFalse(self.ws.of('config')[-1]['config']['readableLineWidth'])
        self.assertTrue(self.ws.of('theme'))
        settings.set('theme.name', 'sublime')
        self.assertTrue(sublime.pump_until(lambda: any(m['theme']['kind'] == 'vscode' for m in self.ws.of('theme')), timeout=2))
        self.assertIn('--vscode-editor-background', self.manager.scheme_css())
        self.assertTrue(session.connected)

    def test_reattach_by_file_after_reload(self):
        session, _ = self.connect()
        # a browser tab from a previous plugin life (unknown sid) attaches by file name
        ws2 = FakeWS()
        again = self.manager.attach('v999', self.note, ws2)
        self.assertIs(again, session)
        self.manager.handle(again, {'type': 'resync'})
        self.assertEqual(ws2.of('update')[-1]['text'], util.view_text(self.view))
        # unknown sid and file → rejected
        self.assertIsNone(self.manager.attach('v998', os.path.join(self.vault, 'nope.md'), FakeWS()))


    def test_landing_page_from_server_thread(self):
        import http.client
        import threading
        from iMark.imark_lib.sync import Hooks
        self.connect()
        hooks = Hooks(self.manager)
        box = {}

        def worker():
            # Server threads must never touch the Sublime API directly; the landing
            # page gathers view state through call_on_main while the main loop pumps.
            box['html'] = hooks.landing_html()
            conn = http.client.HTTPConnection('127.0.0.1', self.manager.server.port, timeout=5)
            conn.request('GET', '/')
            res = conn.getresponse()
            box['status'] = res.status
            box['body'] = res.read().decode('utf-8')
            conn.close()

        t = threading.Thread(target=worker)
        t.start()
        self.assertTrue(sublime.pump_until(lambda: 'body' in box, timeout=5))
        t.join(1)
        self.assertIn('Alpha.md', box['html'])
        self.assertEqual(box['status'], 200)
        self.assertIn('Alpha.md', box['body'])


class CommandsTest(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        plugin.plugin_loaded()
        self.vault = _env.make_vault()
        self.window = sublime.Window(folders=[self.vault])

    def tearDown(self):
        plugin.plugin_unloaded()

    def test_open_command_enablement(self):
        cmd = plugin.ImarkOpenCommand(self.window)
        self.assertFalse(cmd.is_enabled())
        self.window.open_file(os.path.join(self.vault, 'Other', 'Beta.md'))
        self.assertTrue(cmd.is_enabled())
        self.assertTrue(cmd.is_enabled(files=[os.path.join(self.vault, 'Notes', 'Alpha.md')]))
        self.assertFalse(cmd.is_enabled(files=[os.path.join(self.vault, 'attachments', 'pic.png')]))
        cmd.run(files=[os.path.join(self.vault, 'Notes', 'Alpha.md')])
        self.assertTrue(plugin.manager.server.running)
        self.assertEqual(len(plugin.manager.sessions), 1)
        self.assertIn(('open_url', {'url': plugin.manager.server.edit_url(list(plugin.manager.sessions.values())[0].sid, os.path.join(self.vault, 'Notes', 'Alpha.md'))}), self.window.commands)

    def test_select_theme_quick_panel(self):
        self.window.run_command('imark_select_theme')
        panel = self.window.quick_panels[-1]
        triggers = [i.trigger for i in panel['items']]
        self.assertEqual(triggers[:3], ['Monokai Syntax', 'Follow Sublime Text', 'Obsidian default'])
        self.assertEqual(panel['selected_index'], 0)
        panel['on_select'](1)
        self.assertEqual(sublime.load_settings(util.SETTINGS_FILE).get('theme.name'), 'sublime')

    def test_import_theme_from_sidebar(self):
        sublime.dialog_answers['yes_no_cancel'] = sublime.DIALOG_YES
        self.window.run_command('imark_import_theme', {'paths': [self.vault]})
        settings = sublime.load_settings(util.SETTINGS_FILE)
        self.assertEqual(settings.get('theme.name'), 'Minimal')
        self.assertEqual(settings.get('theme.mode'), 'light')
        self.assertEqual(settings.get('theme.snippets'), ['wide.css'])
        self.assertTrue(os.path.isfile(os.path.join(plugin.manager.themes.library_dir, 'Minimal', 'theme.css')))
        self.window.run_command('imark_remove_theme')
        self.window.quick_panels[-1]['on_select'](0)
        self.assertFalse(os.path.isdir(os.path.join(plugin.manager.themes.library_dir, 'Minimal')))
        self.assertEqual(settings.get('theme.name'), 'Monokai Syntax')

    def test_toggle_readable_line_width(self):
        sublime.run_command('imark_toggle_readable_line_width')
        self.assertFalse(sublime.load_settings(util.SETTINGS_FILE).get('editor.readable_line_width'))


if __name__ == '__main__':
    unittest.main()
