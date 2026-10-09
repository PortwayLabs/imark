"""Reading sheet, inline phantoms and hover popups against the fake Sublime API."""
import os
import unittest

import _env  # pylint: disable=unused-import

import sublime  # noqa: E402
import sublime_plugin  # noqa: E402
import iMark.imark as plugin  # noqa: E402
from iMark.imark_lib import preview as preview_mod, util  # noqa: E402
from test_markdown_min import PNG_1X1  # noqa: E402

NOTE = """---
title: Alpha
---

# Alpha

Intro with [[Beta]] and [[Missing]] and a [site](https://example.com) and note[^1].

![[pic.png]]

![shot](../attachments/pic.png)

```mermaid
graph TD
  A --> B
```

| a | b |
| - | - |
| 1 | 2 |

[^1]: Footnote body
"""


class PreviewTest(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        plugin.plugin_loaded()
        self.preview = plugin.preview
        self.vault = _env.make_vault()
        with open(os.path.join(self.vault, 'attachments', 'pic.png'), 'wb') as fh:
            fh.write(PNG_1X1)
        self.note_path = os.path.join(self.vault, 'Notes', 'Alpha.md')
        with open(self.note_path, 'w', encoding='utf-8') as fh:
            fh.write(NOTE)
        self.window = sublime.Window(folders=[self.vault])
        self.view = self.window.open_file(self.note_path)

    def tearDown(self):
        plugin.plugin_unloaded()

    # ---- reading sheet -----------------------------------------------------------------------------

    def test_toggle_sheet_creates_split_and_renders(self):
        self.assertEqual(self.window.num_groups(), 1)
        self.window.run_command('imark_toggle_reading_sheet')
        sheet = self.preview.sheet_for_window(self.window)
        self.assertIsNotNone(sheet)
        self.assertEqual(self.window.num_groups(), 2)
        self.assertTrue(sheet.preview.is_scratch())
        self.assertTrue(sheet.preview.is_read_only())
        self.assertTrue(sheet.preview.settings().get(preview_mod.PREVIEW_SETTING))
        self.assertEqual(self.window.get_view_index(sheet.preview)[0], 1)
        self.assertIs(self.window.active_view(), self.view, 'focus stays on the source')
        self.assertEqual(sheet.preview.name(), 'iMark · Alpha')
        phantoms = sheet.preview.phantoms(preview_mod.PHANTOM_KEY_SHEET)
        self.assertEqual(len(phantoms), 1)
        html = phantoms[0].content
        self.assertIn('<h1>Alpha</h1>', html)
        self.assertIn('href="wiki:Beta"', html)
        self.assertIn('class="internal unresolved" href="wiki:Missing"', html)
        self.assertIn('<img src="file://', html)
        self.assertIn('Mermaid diagram', html)
        self.assertIn('<div class="props">', html)
        # toggling again closes the sheet and restores the single column
        self.window.run_command('imark_toggle_reading_sheet')
        self.assertIsNone(self.preview.sheet_for_window(self.window))
        self.assertEqual(self.window.num_groups(), 1)

    def test_sheet_refreshes_on_typing_and_follows_active_view(self):
        self.preview.toggle_sheet(self.view)
        sheet = self.preview.sheet_for_window(self.window)
        self.view.set_text(NOTE + '\n## Added heading\n')
        self.assertTrue(sublime.pump_until(lambda: 'Added heading' in sheet.preview.phantoms(preview_mod.PHANTOM_KEY_SHEET)[0].content, timeout=3))
        other = self.window.open_file(os.path.join(self.vault, 'Other', 'Beta.md'))
        self.assertEqual(sheet.source_id, other.id())
        self.assertIn('Other Beta', sheet.preview.phantoms(preview_mod.PHANTOM_KEY_SHEET)[0].content)
        self.assertEqual(sheet.preview.name(), 'iMark · Beta')
        # closing the preview view cleans up
        sheet.preview.close()
        self.assertIsNone(self.preview.sheet_for_window(self.window))

    def test_large_documents_refresh_only_on_save(self):
        sublime.load_settings(util.SETTINGS_FILE).set('preview.max_size_kb', 1)
        self.preview.toggle_sheet(self.view)
        sheet = self.preview.sheet_for_window(self.window)
        big = NOTE + ('lorem ipsum ' * 200) + '\n'
        self.view.set_text(big)
        sublime.pump(0.5)
        self.assertNotIn('lorem ipsum', sheet.preview.phantoms(preview_mod.PHANTOM_KEY_SHEET)[0].content)
        self.view.run_command('save')
        html = sheet.preview.phantoms(preview_mod.PHANTOM_KEY_SHEET)[0].content
        self.assertIn('lorem ipsum', html)
        self.assertIn('Large document', html)

    def test_navigation(self):
        self.preview.toggle_sheet(self.view)
        self.preview.navigate(self.view, 'wiki:Beta')
        self.assertIsNotNone(self.window.find_open_file(os.path.join(self.vault, 'Other', 'Beta.md')))
        self.preview.navigate(self.view, 'https://example.com/')
        self.assertIn(('open_url', {'url': 'https://example.com/'}), self.window.commands)
        self.preview.navigate(self.view, 'wiki:Missing')
        self.assertTrue(any('does not exist' in m for _, m in sublime.messages))
        self.preview.navigate(self.view, 'imark:open')
        self.assertTrue(plugin.manager.server.running)
        self.preview.navigate(self.view, 'tag:x')
        self.assertIn(('show_panel', {'panel': 'find_in_files', 'where': '<project>'}), self.window.commands)

    # ---- inline phantoms ---------------------------------------------------------------------------------

    def test_inline_images_and_mermaid_hint(self):
        self.preview.refresh_inline(self.view, immediate=True)
        phantoms = self.view.phantoms(preview_mod.PHANTOM_KEY_INLINE)
        kinds = [('img' if '<img' in p.content else 'hint') for p in phantoms]
        self.assertEqual(kinds, ['img', 'img', 'hint'])
        # images hang below the line of the link
        first_line_end = self.view.line(self.view.find('!\\[\\[pic.png\\]\\]', 0).end()).end()
        self.assertEqual(phantoms[0].region.a, first_line_end)
        self.assertIn('width="32"', phantoms[0].content)
        self.assertIn('imark:open', phantoms[2].content)
        # turning the setting off clears them
        sublime.load_settings(util.SETTINGS_FILE).set('preview.inline_images', False)
        sublime.load_settings(util.SETTINGS_FILE).set('preview.block_hints', False)
        self.assertTrue(sublime.pump_until(lambda: not self.view.phantoms(preview_mod.PHANTOM_KEY_INLINE), timeout=3))

    def test_inline_refresh_after_edit(self):
        self.preview.refresh_inline(self.view, immediate=True)
        self.assertEqual(len(self.view.phantoms(preview_mod.PHANTOM_KEY_INLINE)), 3)
        self.view.set_text('# Empty\n')
        self.assertTrue(sublime.pump_until(lambda: self.view.phantoms(preview_mod.PHANTOM_KEY_INLINE) == [], timeout=3))

    # ---- hover popups -------------------------------------------------------------------------------------

    def hover_at(self, needle):
        region = self.view.find(needle, 0, sublime.LITERAL)
        self.assertGreaterEqual(region.a, 0, needle)
        sublime_plugin.dispatch_event('on_hover', self.view, region.a + 2, sublime.HOVER_TEXT)
        return self.view.popups[-1]['content'] if self.view.popups else None

    def test_hover_popups(self):
        html = self.hover_at('[[Beta]]')
        self.assertIn('Other Beta', html)
        self.assertIn('Open in Sublime Text', html)
        html = self.hover_at('[[Missing]]')
        self.assertIn('Unresolved link', html)
        html = self.hover_at('[site](https://example.com)')
        self.assertIn('href="https://example.com"', html)
        html = self.hover_at('![shot](../attachments/pic.png)')
        self.assertIn('<img src="file://', html)
        self.assertIn('32×16', html)
        html = self.hover_at('[^1].')
        self.assertIn('Footnote [1]', html)
        self.assertIn('Footnote body', html)
        before = len(self.view.popups)
        sublime_plugin.dispatch_event('on_hover', self.view, 0, sublime.HOVER_GUTTER)
        self.assertEqual(len(self.view.popups), before)
        sublime.load_settings(util.SETTINGS_FILE).set('preview.hover_popups', False)
        self.hover_at('[[Beta]]')
        self.assertEqual(len(self.view.popups), before)


if __name__ == '__main__':
    unittest.main()
