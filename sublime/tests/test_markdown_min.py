import os
import tempfile
import unittest

import _env  # pylint: disable=unused-import

from iMark.imark_lib import imgsize, markdown_min as md  # noqa: E402

PNG_1X1 = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000200000001008060000006e0b2c81'
    '0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082'
)


class ImgSizeTest(unittest.TestCase):
    def test_png_and_gif_and_jpeg_headers(self):
        d = tempfile.mkdtemp()
        png = os.path.join(d, 'a.png')
        with open(png, 'wb') as fh:
            fh.write(PNG_1X1)
        self.assertEqual(imgsize.image_size(png), (32, 16))
        gif = os.path.join(d, 'a.gif')
        with open(gif, 'wb') as fh:
            fh.write(b'GIF89a' + (300).to_bytes(2, 'little') + (200).to_bytes(2, 'little') + b'\x00' * 10)
        self.assertEqual(imgsize.image_size(gif), (300, 200))
        jpg = os.path.join(d, 'a.jpg')
        # SOI, APP0 (len 16), SOF0 with height 480 width 640
        sof = b'\xff\xc0' + (11).to_bytes(2, 'big') + b'\x08' + (480).to_bytes(2, 'big') + (640).to_bytes(2, 'big') + b'\x03' + b'\x00' * 3
        with open(jpg, 'wb') as fh:
            fh.write(b'\xff\xd8' + b'\xff\xe0' + (16).to_bytes(2, 'big') + b'JFIF\x00' + b'\x00' * 9 + sof)
        self.assertEqual(imgsize.image_size(jpg), (640, 480))
        self.assertIsNone(imgsize.image_size(os.path.join(d, 'missing.png')))
        self.assertEqual(imgsize.fit(1200, 600, 640), (640, 320))
        self.assertEqual(imgsize.fit(300, 100, 640), (300, 100))


class InlineTest(unittest.TestCase):
    def setUp(self):
        self.ctx = md.RenderContext(
            resolve_image=lambda src: {'url': 'file:///img/%s' % src, 'path': '/img/' + src, 'width': 1000, 'height': 500} if src.endswith('.png') else None,
            resolve_note=lambda t: '/notes/%s.md' % t if t in ('Alpha', 'Beta') else None,
            read_note=lambda t: '# Beta\n\nBody of **Beta**\n' if t == 'Beta' else None,
            max_image_width=400,
        )

    def r(self, text):
        return md.render_inline(text, self.ctx)

    def test_emphasis_code_and_escaping(self):
        self.assertEqual(self.r('**b** *i* ~~s~~ ==h== `c<d>`'), '<b>b</b> <i>i</i> <span class="strike">s</span> <span class="hl">h</span> <code>c&lt;d&gt;</code>')
        self.assertEqual(self.r('a < b & c'), 'a &lt; b &amp; c')
        self.assertEqual(self.r(r'\*not em\*'), '*not em*')
        self.assertEqual(self.r('snake_case_name stays'), 'snake_case_name stays')
        self.assertEqual(self.r('$E=mc^2$'), '<code class="math">E=mc^2</code>')

    def test_links_wikilinks_tags_footnotes(self):
        self.assertEqual(self.r('[t](https://x.y/z)'), '<a href="https://x.y/z">t</a>')
        self.assertEqual(self.r('see https://a.b/c.'), 'see <a href="https://a.b/c">https://a.b/c</a>.')
        self.assertEqual(self.r('[[Alpha]]'), '<a class="internal" href="wiki:Alpha">Alpha</a>')
        self.assertEqual(self.r('[[Alpha|Nice]]'), '<a class="internal" href="wiki:Alpha|Nice">Nice</a>')
        self.assertEqual(self.r('[[Alpha#Head]]'), '<a class="internal" href="wiki:Alpha#Head">Alpha › Head</a>')
        self.assertEqual(self.r('[[Nope]]'), '<a class="internal unresolved" href="wiki:Nope">Nope</a>')
        self.assertEqual(self.r('#tag/x and #标签 but not a#b or #1'), '<a class="tag" href="tag:tag/x">#tag/x</a> and <a class="tag" href="tag:标签">#标签</a> but not a#b or #1')
        self.assertEqual(self.r('x[^1]'), 'x<a class="fnref" href="#fn-1"><small>[1]</small></a>')

    def test_images_and_embeds(self):
        self.assertEqual(self.r('![alt](pic.png)'), '<img src="file:///img/pic.png" width="400" height="200">')
        self.assertEqual(self.r('![[pic.png|200]]'), '<img src="file:///img/pic.png" width="200" height="100">')
        self.assertIn('img-missing', self.r('![x](https://remote/pic.png)'))
        self.assertIn('remote images', self.r('![x](https://remote/pic.png)'))
        self.assertIn('img-missing', self.r('![x](nope.svg)'))
        embedded = self.r('![[Beta]]')
        self.assertIn('<div class="embed">', embedded)
        self.assertIn('<h1>Beta</h1>', embedded)
        self.assertIn('<b>Beta</b>', embedded)
        self.assertIn('unresolved', self.r('![[Nope]]'))

    def test_breaks_and_comments(self):
        self.assertEqual(self.r('a\nb'), 'a<br>b')
        self.assertEqual(self.r('a  \nb'), 'a<br>b')
        self.assertEqual(self.r('a<br>b'), 'a<br>b')


class BlockTest(unittest.TestCase):
    def setUp(self):
        self.ctx = md.RenderContext(title='Note')

    def frag(self, text):
        return md.render_fragment(text, self.ctx)

    def test_headings_paragraphs_hr(self):
        html = self.frag('# H1\n\nPara one\nline two\n\n---\n\n## H2 ##\n')
        self.assertIn('<h1>H1</h1>', html)
        self.assertIn('<p>Para one<br>line two</p>', html)
        self.assertIn('<div class="hr">', html)
        self.assertIn('<h2>H2</h2>', html)

    def test_front_matter(self):
        html = self.frag('---\ntitle: Hello\ntags: [a, b]\nstatus: draft\n---\n\nBody\n')
        self.assertIn('<div class="props">', html)
        self.assertIn('<span class="k">title</span>', html)
        self.assertIn('<span class="pill">a</span>', html)
        self.assertIn('<p>Body</p>', html)
        self.assertNotIn('title: Hello', html)

    def test_code_math_and_mermaid(self):
        html = self.frag('```python\ndef f():\n    return "<x>"\n```\n')
        self.assertIn('<div class="lang">python</div>', html)
        self.assertIn('&nbsp;&nbsp;&nbsp;&nbsp;return &quot;&lt;x&gt;&quot;', html)
        html = self.frag('```mermaid\ngraph TD\n  A-->B\n```\n')
        self.assertIn('Mermaid diagram', html)
        self.assertIn('href="imark:open"', html)
        self.assertIn('A--&gt;B', html)
        html = self.frag('$$\n\\int_0^1 x\n$$\n')
        self.assertIn('Math block', html)
        self.assertIn('\\int_0^1 x', html)
        self.assertIn('Math block', self.frag('$$ a+b $$\n'))

    def test_lists_and_tasks(self):
        html = self.frag('- one\n- two\n  - nested\n- [ ] todo\n- [x] done\n\n1. first\n2. second\n')
        self.assertIn('<ul><li>one</li><li>two<ul><li>nested</li></ul></li>', html)
        self.assertIn('<li>☐ todo</li>', html)
        self.assertIn('<li class="task-done"><span class="task-done">☑</span> done</li>', html)
        self.assertIn('<ol><li>first</li><li>second</li></ol>', html)

    def test_quotes_and_callouts(self):
        html = self.frag('> quoted\n> more\n')
        self.assertIn('<div class="quote"><p>quoted<br>more</p></div>', html)
        html = self.frag('> [!warning] Careful\n> body **here**\n')
        self.assertIn('callout callout-orangish', html)
        self.assertIn('Careful', html)
        self.assertIn('<b>here</b>', html)
        html = self.frag('> [!note]\n> text\n')
        self.assertIn('Note', html)
        self.assertIn('callout-bluish', html)

    def test_tables_become_monospace(self):
        html = self.frag('| Name | Qty |\n| :--- | ---: |\n| 苹果 | 3 |\n| Pear | 12 |\n')
        self.assertIn('<div class="code">', html)
        plain = html.replace('&nbsp;', ' ')
        self.assertIn('| Name | Qty |', plain)
        self.assertIn('|------|-----|', plain)
        self.assertIn('| 苹果 |   3 |', plain)
        self.assertIn('| Pear |  12 |', plain)

    def test_footnotes_and_document(self):
        doc = md.render_document('Text[^a]\n\n[^a]: The note *here*\n', self.ctx)
        self.assertTrue(doc.startswith('<body id="imark-preview"><style>'))
        self.assertIn('<div class="imark-title">Note</div>', doc)
        self.assertIn('<div class="footnotes">', doc)
        self.assertIn('<div id="fn-a"><small>[a]</small> The note <i>here</i></div>', doc)

    def test_comments_removed_and_html_escaped(self):
        html = self.frag('visible %%hidden%% <script>alert(1)</script>\n<!-- gone -->\n')
        self.assertNotIn('hidden', html)
        self.assertNotIn('gone', html)
        self.assertIn('&lt;script&gt;', html)

    def test_section_of_and_popup(self):
        text = '# A\n\nintro\n\n## B\n\nb-body\n\n## C\n\nc-body\n'
        self.assertEqual(md.section_of(text, 'B'), '## B\n\nb-body\n')
        popup = md.render_popup('\n'.join('line %d' % i for i in range(30)), self.ctx, max_lines=5)
        self.assertIn('line 4', popup)
        self.assertNotIn('line 6', popup)
        self.assertIn('…', popup)

    def test_strip_markup(self):
        self.assertEqual(md.strip_markup('**a** [[B|c]] `d` ![[e.png]] [f](g)'), 'a c d e.png f')


if __name__ == '__main__':
    unittest.main()
