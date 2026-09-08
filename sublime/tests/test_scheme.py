import unittest

import _env  # pylint: disable=unused-import

import sublime  # noqa: E402
from iMark.imark_lib import scheme  # noqa: E402


class SchemeTest(unittest.TestCase):
    def test_color_parsing_and_math(self):
        self.assertEqual(scheme.parse_color('#fff'), (255, 255, 255, 1.0))
        self.assertEqual(scheme.parse_color('#27282280')[:3], (39, 40, 34))
        self.assertAlmostEqual(scheme.parse_color('#27282280')[3], 128 / 255.0)
        self.assertEqual(scheme.parse_color('rgba(1, 2, 3, 0.5)'), (1, 2, 3, 0.5))
        self.assertIsNone(scheme.parse_color('red'))
        self.assertEqual(scheme.mix('#000000', '#ffffff', 0.5), '#808080')
        self.assertTrue(scheme.is_dark('#272822'))
        self.assertFalse(scheme.is_dark('#ffffff'))
        self.assertEqual(scheme.contrast_text('#ffffff'), '#000000')
        self.assertEqual(scheme.contrast_text('#202020'), '#ffffff')
        self.assertEqual(scheme.rgba('#ff0000', 0.25), 'rgba(255, 0, 0, 0.25)')

    def test_scheme_variables_dark_and_light(self):
        dark = scheme.scheme_variables(sublime.DEFAULT_STYLE, lambda s: sublime.SCOPE_COLORS.get(s), 'Menlo')
        self.assertEqual(dark['--vscode-editor-background'], '#272822')
        self.assertEqual(dark['--vscode-symbolIcon-keywordForeground'], '#f92672')
        self.assertEqual(dark['--vscode-focusBorder'], '#66d9ef')
        self.assertEqual(dark['--vscode-button-foreground'], '#000000')
        self.assertTrue(dark['--vscode-editor-font-family'].startswith('"Menlo", '))
        self.assertEqual(dark['--imark-vscode-accent-rgb'], '102, 217, 239')
        self.assertEqual(dark['--vscode-widget-shadow'], 'rgba(0, 0, 0, 0.36)')

        light = scheme.scheme_variables({'background': '#ffffff', 'foreground': '#333333'}, lambda s: None)
        self.assertEqual(light['--vscode-editor-background'], '#ffffff')
        self.assertEqual(light['--vscode-focusBorder'], '#005fb8')
        self.assertEqual(light['--vscode-widget-shadow'], 'rgba(0, 0, 0, 0.16)')
        self.assertEqual(light['--vscode-symbolIcon-keywordForeground'], '#333333')

    def test_scheme_css_from_view(self):
        window = sublime.Window()
        view = window.new_file()
        css = scheme.scheme_css(view)
        self.assertTrue(css.startswith('body.imark-vscode-bridge {'))
        self.assertIn('--vscode-editor-background: #272822;', css)
        self.assertTrue(scheme.view_is_dark(view))
        view.style_overrides['background'] = '#fafafa'
        self.assertFalse(scheme.view_is_dark(view))
        self.assertEqual(scheme.scheme_css(None), '')


if __name__ == '__main__':
    unittest.main()
