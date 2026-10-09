import os
import tempfile
import unittest

import _env  # pylint: disable=unused-import

import sublime  # noqa: E402
from iMark.imark_lib import themes, util  # noqa: E402


class FakeServer:
    def base_url(self):
        return 'http://127.0.0.1:1'

    def web_url(self, rel):
        return 'http://127.0.0.1:1/web/' + rel

    def url_for_file(self, path):
        return 'http://127.0.0.1:1/r/tok/0/' + os.path.basename(path)


class ThemeHelpersTest(unittest.TestCase):
    def setUp(self):
        self.vault = _env.make_vault()

    def test_plan_import_variants(self):
        plan = themes.plan_import(os.path.join(self.vault, '.obsidian', 'themes', 'Minimal'))
        self.assertEqual([t['name'] for t in plan['themes']], ['Minimal'])
        self.assertEqual(plan['themes'][0]['author'], 'kepano')
        self.assertIsNone(plan['appearance'])

        plan = themes.plan_import(os.path.join(self.vault, '.obsidian', 'themes', 'Minimal', 'theme.css'))
        self.assertEqual(len(plan['themes']), 1)

        for picked in (self.vault, os.path.join(self.vault, '.obsidian'), os.path.join(self.vault, '.obsidian', 'themes')):
            plan = themes.plan_import(picked)
            self.assertEqual([t['id'] for t in plan['themes']], ['Minimal'], picked)
            self.assertEqual(plan['appearance']['cssTheme'], 'Minimal')
            self.assertEqual([os.path.basename(s) for s in plan['snippets']], ['wide.css'])
            self.assertTrue(plan['vault_snippets_dir'].endswith('snippets'))

        plan = themes.plan_import(os.path.join(self.vault, '.obsidian', 'snippets', 'wide.css'))
        self.assertEqual(plan['themes'], [])
        self.assertEqual(len(plan['snippets']), 1)
        self.assertEqual(themes.plan_import(os.path.join(self.vault, 'nope'))['themes'], [])

    def test_copy_theme_and_sanitize(self):
        lib = tempfile.mkdtemp()
        src = themes.theme_source(os.path.join(self.vault, '.obsidian', 'themes', 'Minimal'))
        src['id'] = 'Bad/Name:*'
        target = themes.copy_theme(src, lib)
        self.assertEqual(os.path.basename(target), 'Bad_Name__')
        self.assertTrue(os.path.isfile(os.path.join(target, 'theme.css')))
        self.assertTrue(os.path.isfile(os.path.join(target, 'manifest.json')))
        self.assertEqual(themes.sanitize_id('  '), 'theme')

    def test_misc_helpers(self):
        self.assertEqual(themes.hex_to_hsl('#7c3aed'), (262, 83, 58))
        self.assertEqual(themes.hex_to_hsl('fff'), (0, 0, 100))
        self.assertIsNone(themes.hex_to_hsl('nope'))
        self.assertEqual(themes.appearance_mode('obsidian'), 'dark')
        self.assertEqual(themes.appearance_mode('moonstone'), 'light')
        self.assertEqual(themes.appearance_mode('system'), 'auto')
        self.assertIsNone(themes.appearance_mode('x'))
        self.assertEqual(themes.find_vault_dir(os.path.join(self.vault, 'Notes', 'sub')), self.vault)
        self.assertIsNone(themes.find_vault_dir(tempfile.gettempdir()))


class ThemeLibraryTest(unittest.TestCase):
    def setUp(self):
        sublime.reset()
        self.vault = _env.make_vault()
        self.user = tempfile.mkdtemp()
        self.lib = themes.ThemeLibrary(os.path.join(_env.WEB, 'themes'), os.path.join(self.user, 'themes'), os.path.join(self.user, 'snippets'))
        self.settings = sublime.load_settings(util.SETTINGS_FILE)

    def test_default_resolves_to_bundled_theme(self):
        r = self.lib.resolve()
        self.assertEqual((r['kind'], r['name']), ('theme', 'Monokai Syntax'))
        self.assertEqual(len(r['css_paths']), 1)
        info = self.lib.to_theme_info(FakeServer(), r)
        self.assertEqual(info['cssUris'], ['http://127.0.0.1:1/r/tok/0/theme.css'])
        self.assertEqual(info['mode'], 'auto')

    def test_sublime_and_obsidian_kinds(self):
        self.settings.set('theme.name', 'sublime')
        r = self.lib.resolve()
        self.assertEqual((r['kind'], r['name']), ('vscode', 'Follow Sublime Text'))
        info = self.lib.to_theme_info(FakeServer(), r)
        self.assertTrue(info['cssUris'][0].endswith('css/vscode-bridge.css'))
        self.assertIn('/scheme.css?v=', info['cssUris'][1])
        self.settings.set('theme.name', 'obsidian')
        self.assertEqual(self.lib.resolve()['kind'], 'obsidian')

    def test_missing_theme_falls_back(self):
        self.settings.set('theme.name', 'Nope')
        r = self.lib.resolve()
        self.assertEqual(r['missing'], 'Nope')
        self.assertIn('not found', r['name'])
        self.assertEqual(len(r['css_paths']), 1)

    def test_import_apply_and_remove(self):
        result = self.lib.import_from([self.vault])
        self.assertEqual([t['name'] for t in result['themes']], ['Minimal'])
        self.assertEqual([os.path.basename(s) for s in result['snippets']], ['wide.css'])
        self.assertEqual([t['origin'] for t in self.lib.list_themes() if t['name'] == 'Minimal'], ['library'])
        applied = self.lib.apply_appearance(result['plan'], result)
        self.assertEqual(applied, ['theme "Minimal"', 'mode light', 'accent #7c3aed', '1 snippet(s)'])
        self.assertEqual(self.settings.get('theme.name'), 'Minimal')
        r = self.lib.resolve()
        self.assertEqual(r['name'], 'Minimal')
        self.assertEqual(r['mode'], 'light')
        self.assertEqual([os.path.basename(p) for p in r['css_paths']], ['theme.css', 'wide.css'])
        info = self.lib.to_theme_info(FakeServer(), r)
        self.assertIn('--accent-h:262', info['extraCss'])
        self.assertTrue(self.lib.remove_theme('Minimal'))
        self.assertFalse(self.lib.remove_theme('Minimal'))
        self.assertIsNone(self.lib.find_theme('Minimal'))

    def test_external_dir_and_snippet_resolution(self):
        self.settings.set('theme.path', os.path.join(self.vault, '.obsidian', 'themes'))
        names = {t['name']: t['origin'] for t in self.lib.list_themes()}
        self.assertEqual(names.get('Minimal'), 'external')
        self.settings.set('theme.name', 'Minimal')
        self.settings.set('theme.snippets', ['wide', os.path.join(self.vault, '.obsidian', 'snippets', 'wide.css'), 'missing'])
        r = self.lib.resolve()
        self.assertEqual([os.path.basename(p) for p in r['css_paths']], ['theme.css', 'wide.css', 'wide.css'])
        self.assertEqual(self.lib.suggested_import_dir(os.path.join(self.vault, 'Notes', 'Alpha.md'), []), os.path.join(self.vault, '.obsidian', 'themes'))


if __name__ == '__main__':
    unittest.main()
