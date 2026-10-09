import unittest

import _env  # noqa: F401  pylint: disable=unused-import

from iMark.imark_lib import textutil  # noqa: E402


class TextUtilTest(unittest.TestCase):
    def test_utf16_offsets_without_astral_are_identity(self):
        text = 'héllo wörld'
        self.assertFalse(textutil.has_astral(text))
        self.assertEqual(textutil.utf16_to_index(text, 5), 5)
        self.assertEqual(textutil.utf16_to_index(text, len(text)), len(text))
        with self.assertRaises(ValueError):
            textutil.utf16_to_index(text, len(text) + 1)

    def test_utf16_offsets_with_emoji(self):
        text = 'a😀b'  # 😀 is 2 UTF-16 units
        self.assertTrue(textutil.has_astral(text))
        self.assertEqual(textutil.utf16_length(text), 4)
        self.assertEqual(textutil.utf16_to_index(text, 0), 0)
        self.assertEqual(textutil.utf16_to_index(text, 1), 1)
        self.assertEqual(textutil.utf16_to_index(text, 3), 2)
        self.assertEqual(textutil.utf16_to_index(text, 4), 3)
        with self.assertRaises(ValueError):
            textutil.utf16_to_index(text, 2)  # inside the surrogate pair

    def test_convert_and_apply_changes(self):
        text = 'a😀b'
        converted = textutil.convert_changes(text, [{'from': 3, 'to': 3, 'insert': 'X'}])
        self.assertEqual(converted, [(2, 2, 'X')])
        self.assertEqual(textutil.apply_changes(text, converted), 'a😀Xb')
        # unsorted input is sorted; overlapping input is rejected
        converted = textutil.convert_changes('hello world', [{'from': 6, 'to': 11, 'insert': 'moon'}, {'from': 0, 'to': 5, 'insert': 'goodbye'}])
        self.assertEqual(textutil.apply_changes('hello world', converted), 'goodbye moon')
        with self.assertRaises(ValueError):
            textutil.convert_changes('abc', [{'from': 0, 'to': 2, 'insert': ''}, {'from': 1, 'to': 3, 'insert': ''}])
        with self.assertRaises(ValueError):
            textutil.convert_changes('abc', [{'from': 2, 'to': 1, 'insert': ''}])

    def test_apply_changes_matches_protocol_helper(self):
        self.assertEqual(textutil.apply_changes('abc', [(1, 1, 'X')]), 'aXbc')
        self.assertEqual(textutil.apply_changes('abc', [(3, 3, '\n')]), 'abc\n')
        with self.assertRaises(ValueError):
            textutil.apply_changes('abc', [(2, 2, 'x'), (1, 1, 'y')])

    def test_diff_change(self):
        self.assertIsNone(textutil.diff_change('abc', 'abc'))
        self.assertEqual(textutil.diff_change('hello world', 'hello brave world'), (6, 6, 'brave '))
        self.assertEqual(textutil.diff_change('aaa', 'a'), (1, 3, ''))

    def test_sanitize_and_eol(self):
        self.assertEqual(textutil.sanitize_text('ok'), 'ok')
        self.assertEqual(textutil.sanitize_text('a\ud83db'), 'a?b')
        self.assertEqual(textutil.normalize_eol('a\r\nb\rc\n'), 'a\nb\nc\n')


if __name__ == '__main__':
    unittest.main()
