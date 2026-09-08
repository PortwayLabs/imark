import unittest

import _env  # noqa: F401  pylint: disable=unused-import

from iMark.imark_lib.links import FileLookup, normalize_path, parse_target  # noqa: E402

FILES = [
    {'root': 0, 'path': 'Notes/Alpha.md'},
    {'root': 0, 'path': 'Notes/sub/Beta.md'},
    {'root': 0, 'path': 'Other/Beta.md'},
    {'root': 0, 'path': 'attachments/pic.png'},
    {'root': 0, 'path': 'Notes/local.png'},
]


class LinksTest(unittest.TestCase):
    def setUp(self):
        self.lookup = FileLookup(FILES)

    def test_parse_target(self):
        t = parse_target('Note#Head|Alias')
        self.assertEqual((t.path, t.heading, t.alias), ('Note', 'Head', 'Alias'))
        t = parse_target('Note#^abc')
        self.assertEqual((t.path, t.block), ('Note', 'abc'))
        t = parse_target('img.png|300x200')
        self.assertEqual((t.path, t.width, t.height, t.alias), ('img.png', 300, 200, None))
        t = parse_target('img.png|300')
        self.assertEqual((t.width, t.height), (300, None))
        self.assertEqual(parse_target('a\\b').path, 'a/b')

    def test_resolves_by_basename(self):
        self.assertEqual(self.lookup.resolve('Alpha', 0, 'Notes/Alpha.md')['path'], 'Notes/Alpha.md')
        self.assertEqual(self.lookup.resolve('alpha.md', 0, 'x.md')['path'], 'Notes/Alpha.md')

    def test_ambiguity_and_folder_hints(self):
        self.assertEqual(self.lookup.resolve('Beta', 0, 'x.md')['path'], 'Other/Beta.md')
        self.assertEqual(self.lookup.resolve('sub/Beta', 0, 'x.md')['path'], 'Notes/sub/Beta.md')
        self.assertEqual(self.lookup.resolve('Notes/sub/Beta', 0, 'x.md')['path'], 'Notes/sub/Beta.md')

    def test_relative_to_document_first(self):
        self.assertEqual(self.lookup.resolve('local.png', 0, 'Notes/Alpha.md')['path'], 'Notes/local.png')
        self.assertEqual(self.lookup.resolve('pic.png', 0, 'Notes/Alpha.md')['path'], 'attachments/pic.png')

    def test_unknown(self):
        self.assertIsNone(self.lookup.resolve('Nope', 0, 'x.md'))
        self.assertIsNone(self.lookup.resolve('', 0, 'x.md'))

    def test_normalize_path(self):
        self.assertEqual(normalize_path('a/./b/../c'), 'a/c')
        self.assertEqual(normalize_path('../x'), 'x')


if __name__ == '__main__':
    unittest.main()
