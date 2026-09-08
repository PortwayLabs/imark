"""Markdown → minihtml renderer for the in-Sublime reading sheet, hover popups
and inline phantoms.

minihtml (Sublime Text's built-in HTML engine) has no JavaScript, tables, SVG,
``white-space`` or ``text-decoration: line-through``; it does support a small
set of block / inline elements, a CSS subset, color-scheme variables such as
``var(--foreground)`` and ``color(... alpha(...))`` and PNG / JPEG / GIF images.
This renderer targets exactly that: it degrades tables to aligned monospace
text, shows math and Mermaid as source with a hint, and keeps everything else
(headings, lists, callouts, code, links, wikilinks, embeds, tags, footnotes,
properties) readable. Pure Python, unit tested."""
import re

from .links import MD_EXT, parse_target

CALLOUT_COLORS = {
    'note': 'bluish', 'info': 'bluish', 'todo': 'bluish',
    'abstract': 'cyanish', 'summary': 'cyanish', 'tldr': 'cyanish', 'tip': 'cyanish', 'hint': 'cyanish', 'important': 'cyanish',
    'success': 'greenish', 'check': 'greenish', 'done': 'greenish',
    'question': 'orangish', 'help': 'orangish', 'faq': 'orangish', 'warning': 'orangish', 'caution': 'orangish', 'attention': 'orangish',
    'failure': 'redish', 'fail': 'redish', 'missing': 'redish', 'danger': 'redish', 'error': 'redish', 'bug': 'redish',
    'example': 'purplish', 'quote': 'foreground', 'cite': 'foreground',
}
CALLOUT_ICONS = {
    'bluish': 'ⓘ', 'cyanish': '✎', 'greenish': '✔', 'orangish': '⚠', 'redish': '✖', 'purplish': '❖', 'foreground': '❝',
}
IMAGE_EXT = re.compile(r'\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$', re.IGNORECASE)
DISPLAYABLE_EXT = re.compile(r'\.(png|jpe?g|gif)$', re.IGNORECASE)

_FENCE = re.compile(r'^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)\s*(.*)$')
_HEADING = re.compile(r'^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$')
_HR = re.compile(r'^ {0,3}([-*_])(?:\s*\1){2,}\s*$')
_QUOTE = re.compile(r'^ {0,3}>\s?(.*)$')
_LIST = re.compile(r'^(\s*)([-*+]|\d+[.)])\s+(.*)$')
_TASK = re.compile(r'^\[( |x|X|-)\]\s+(.*)$')
_TABLE_SEP = re.compile(r'^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$')
_FOOTNOTE_DEF = re.compile(r'^\[\^([^\]]+)\]:\s*(.*)$')
_CALLOUT = re.compile(r'^\[!([\w-]+)\]([+-]?)\s*(.*)$')
_MATH_FENCE = re.compile(r'^\s*\$\$\s*(.*)$')
_COMMENT = re.compile(r'%%.*?%%', re.DOTALL)
_HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)
_INDENT = re.compile(r'^(\s*)')

_INLINE = re.compile(
    r'(?P<esc>\\[\\`*_{}\[\]()#+\-.!|~=$<>])'
    r'|(?P<code>(?P<ticks>`+)(?P<codetext>.+?)(?P=ticks))'
    r'|(?P<math>\$(?P<mathtext>[^$\n]+?)\$)'
    r'|(?P<embed>!\[\[(?P<embedtarget>[^\]]+)\]\])'
    r'|(?P<img>!\[(?P<imgalt>[^\]]*)\]\((?P<imgsrc>[^)\s]+)(?:\s+"[^"]*")?\))'
    r'|(?P<wiki>\[\[(?P<wikitarget>[^\]]+)\]\])'
    r'|(?P<fnref>\[\^(?P<fnid>[^\]]+)\])'
    r'|(?P<link>\[(?P<linktext>[^\]]*)\]\((?P<linkhref>[^)\s]+)(?:\s+"[^"]*")?\))'
    r'|(?P<autolink><(?P<autourl>https?://[^>\s]+)>)'
    r'|(?P<bareurl>https?://[^\s<>()\[\]]+[^\s<>()\[\].,;:!?])'
    r'|(?P<bold>\*\*(?P<boldtext>.+?)\*\*|__(?P<boldtext2>.+?)__)'
    r'|(?P<em>\*(?P<emtext>[^*\n]+?)\*|(?<![\w])_(?P<emtext2>[^_\n]+?)_(?![\w]))'
    r'|(?P<strike>~~(?P<striketext>.+?)~~)'
    r'|(?P<hl>==(?P<hltext>.+?)==)'
    r'|(?P<tag>(?<![\w/&#])#(?P<tagname>[\w/-]*[A-Za-z_À-￿][\w/-]*))'
    r'|(?P<br><br\s*/?>)'
    r'|(?P<hard>(?: {2,}|\\)\n)'
    r'|(?P<nl>\n)',
    re.DOTALL,
)


def escape(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def preserve_spaces(text):
    """Keep runs of spaces and tabs in minihtml (no ``white-space: pre``)."""
    return re.sub(r' {2,}', lambda m: '&nbsp;' * len(m.group(0)), text.replace('\t', '    ')).replace('\n', '<br>')


def strip_markup(text):
    """Rough plain text of inline Markdown (for titles / table cells)."""
    text = re.sub(r'!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]|]+)\|([^\]]*)\]\]', r'\2', text)
    text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text)
    text = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'(\*\*|__|~~|==)(.+?)\1', r'\2', text)
    text = re.sub(r'(?<!\w)[*_](.+?)[*_](?!\w)', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    return text.strip()


class RenderContext:
    """Host callbacks and options for a render.

    - ``resolve_image(src)`` → ``{'url', 'path', 'width', 'height'}`` for a local
      image that minihtml can show (PNG / JPEG / GIF), or ``None``.
    - ``resolve_note(target)`` → absolute path of a note / file, or ``None``.
    - ``read_note(target)`` → text of a Markdown note (for embeds), or ``None``.
    """

    def __init__(self, resolve_image=None, resolve_note=None, read_note=None, font_face=None, max_image_width=640, depth=0, title=None, show_title=True, hint_href='imark:open'):
        self.resolve_image = resolve_image or (lambda src: None)
        self.resolve_note = resolve_note or (lambda target: None)
        self.read_note = read_note or (lambda target: None)
        self.font_face = font_face
        self.max_image_width = max_image_width
        self.depth = depth
        self.title = title
        self.show_title = show_title
        self.hint_href = hint_href
        self.footnotes = {}

    def child(self):
        c = RenderContext(self.resolve_image, self.resolve_note, self.read_note, self.font_face, self.max_image_width, self.depth + 1, None, False, self.hint_href)
        return c


def stylesheet(font_face=None):
    mono = ('"%s", ' % font_face if font_face else '') + 'Menlo, Consolas, "DejaVu Sans Mono", monospace'
    return '''
body { padding: 0.6rem 1.2rem 2rem 1.2rem; }
.imark-title { font-size: 1.9rem; font-weight: bold; margin: 0.4rem 0 1rem 0; }
h1 { font-size: 1.7rem; font-weight: bold; margin: 1.1rem 0 0.5rem 0; }
h2 { font-size: 1.45rem; font-weight: bold; margin: 1rem 0 0.4rem 0; }
h3 { font-size: 1.25rem; font-weight: bold; margin: 0.9rem 0 0.35rem 0; }
h4 { font-size: 1.1rem; font-weight: bold; margin: 0.8rem 0 0.3rem 0; }
h5 { font-size: 1rem; font-weight: bold; margin: 0.7rem 0 0.3rem 0; }
h6 { font-size: 0.95rem; font-weight: bold; margin: 0.7rem 0 0.3rem 0; color: color(var(--foreground) alpha(0.7)); }
p { margin: 0.45rem 0; }
ul, ol { margin: 0.3rem 0 0.3rem 1.2rem; padding: 0; }
li { margin: 0.15rem 0; }
a { color: var(--accent); text-decoration: none; }
a.unresolved { color: color(var(--foreground) alpha(0.5)); text-decoration: underline; }
a.tag { color: var(--bluish); background-color: color(var(--bluish) alpha(0.12)); padding: 0 0.4rem; border-radius: 0.7rem; font-size: 0.9rem; }
code { font-family: %(mono)s; font-size: 0.92rem; background-color: color(var(--foreground) alpha(0.09)); padding: 0 0.25rem; border-radius: 0.2rem; }
.code { display: block; font-family: %(mono)s; font-size: 0.92rem; background-color: color(var(--foreground) alpha(0.07)); padding: 0.5rem 0.75rem; margin: 0.5rem 0; border-radius: 0.3rem; }
.lang { color: color(var(--foreground) alpha(0.5)); font-size: 0.78rem; margin-bottom: 0.2rem; }
.math { color: var(--purplish); }
.quote { border-left: 0.2rem solid color(var(--foreground) alpha(0.3)); padding: 0.1rem 0 0.1rem 0.8rem; margin: 0.5rem 0; color: color(var(--foreground) alpha(0.85)); }
.callout { border-left: 0.25rem solid var(--bluish); background-color: color(var(--bluish) alpha(0.08)); padding: 0.45rem 0.8rem; margin: 0.6rem 0; border-radius: 0.25rem; }
.callout .callout-title { font-weight: bold; color: var(--bluish); }
.callout-cyanish { border-left-color: var(--cyanish); background-color: color(var(--cyanish) alpha(0.08)); } .callout-cyanish .callout-title { color: var(--cyanish); }
.callout-greenish { border-left-color: var(--greenish); background-color: color(var(--greenish) alpha(0.08)); } .callout-greenish .callout-title { color: var(--greenish); }
.callout-orangish { border-left-color: var(--orangish); background-color: color(var(--orangish) alpha(0.08)); } .callout-orangish .callout-title { color: var(--orangish); }
.callout-redish { border-left-color: var(--redish); background-color: color(var(--redish) alpha(0.08)); } .callout-redish .callout-title { color: var(--redish); }
.callout-purplish { border-left-color: var(--purplish); background-color: color(var(--purplish) alpha(0.08)); } .callout-purplish .callout-title { color: var(--purplish); }
.callout-foreground { border-left-color: color(var(--foreground) alpha(0.4)); background-color: color(var(--foreground) alpha(0.05)); } .callout-foreground .callout-title { color: color(var(--foreground) alpha(0.8)); }
.hl { background-color: color(var(--yellowish) alpha(0.35)); }
.strike { color: color(var(--foreground) alpha(0.45)); }
.hr { background-color: color(var(--foreground) alpha(0.18)); font-size: 0.15rem; margin: 0.9rem 0; }
.props { border: 1px solid color(var(--foreground) alpha(0.15)); padding: 0.4rem 0.8rem; margin: 0.3rem 0 0.9rem 0; border-radius: 0.3rem; }
.props .k { color: color(var(--foreground) alpha(0.6)); }
.props .pill { background-color: color(var(--foreground) alpha(0.1)); padding: 0 0.4rem; border-radius: 0.7rem; }
.placeholder { border: 1px solid color(var(--foreground) alpha(0.25)); padding: 0.35rem 0.8rem; margin: 0.5rem 0; color: color(var(--foreground) alpha(0.7)); border-radius: 0.3rem; font-size: 0.9rem; }
.embed { border-left: 0.2rem solid var(--accent); padding: 0.2rem 0.8rem; margin: 0.5rem 0; }
.embed-title { font-size: 0.85rem; color: color(var(--foreground) alpha(0.55)); }
.footnotes { border-top: 1px solid color(var(--foreground) alpha(0.15)); margin-top: 1.2rem; padding-top: 0.4rem; font-size: 0.9rem; color: color(var(--foreground) alpha(0.8)); }
.img-missing { color: color(var(--foreground) alpha(0.55)); font-style: italic; }
.task-done { color: color(var(--foreground) alpha(0.55)); }
small { font-size: 0.8rem; }
''' % {'mono': mono}


# ---- inline -----------------------------------------------------------------------------------

def _wikilink_html(ctx, target, is_embed=False):
    parsed = parse_target(target)
    label = parsed.alias if parsed.alias else (parsed.path or ('#' + (parsed.heading or '')))
    if parsed.heading and not parsed.alias and parsed.path:
        label = '%s › %s' % (parsed.path, parsed.heading)
    path = ctx.resolve_note(parsed.path) if parsed.path else None
    cls = 'internal' if (path or not parsed.path) else 'internal unresolved'
    return '<a class="%s" href="wiki:%s">%s</a>' % (cls, escape(target), escape(label))


def _image_html(ctx, src, alt='', width=None, height=None):
    remote = bool(re.match(r'^[a-z][a-z0-9+.-]*:', src, re.IGNORECASE)) and not src.lower().startswith('file:')
    info = None if remote else ctx.resolve_image(src)
    if not info:
        why = 'remote images are not shown here' if remote else 'not found or not PNG / JPEG / GIF'
        return '<span class="img-missing">[image: %s – %s]</span>' % (escape(alt or src), why)
    w, h = info.get('width'), info.get('height')
    if width and w and h:
        w, h = width, int(round(h * width / float(w))) if not height else height
    elif width:
        w, h = width, height
    if w and ctx.max_image_width and w > ctx.max_image_width:
        h = int(round(h * ctx.max_image_width / float(w))) if h else None
        w = ctx.max_image_width
    attrs = ''
    if w:
        attrs += ' width="%d"' % w
    if h:
        attrs += ' height="%d"' % h
    return '<img src="%s"%s>' % (escape(info['url']), attrs)


def _embed_html(ctx, target):
    parsed = parse_target(target)
    if IMAGE_EXT.search(parsed.path or ''):
        return _image_html(ctx, parsed.path, parsed.alias or parsed.path, parsed.width, parsed.height)
    if ctx.depth >= 2:
        return _wikilink_html(ctx, target)
    text = ctx.read_note(parsed.path) if parsed.path else None
    if text is None:
        return '<div class="embed"><div class="embed-title">%s</div>%s</div>' % (escape(parsed.path), _wikilink_html(ctx, target))
    if parsed.heading:
        text = section_of(text, parsed.heading)
    child = ctx.child()
    return '<div class="embed"><div class="embed-title">%s</div>%s</div>' % (escape(parsed.path), render_fragment(text, child))


def render_inline(text, ctx):
    out = []
    pos = 0
    n = len(text)
    while pos < n:
        m = _INLINE.search(text, pos)
        if not m:
            out.append(escape(text[pos:]))
            break
        if m.start() > pos:
            out.append(escape(text[pos:m.start()]))
        pos = m.end()
        kind = m.lastgroup if m.lastgroup in _INLINE.groupindex else None
        # lastgroup may be an inner named group; find the outer kind
        for name in ('esc', 'code', 'math', 'embed', 'img', 'wiki', 'fnref', 'link', 'autolink', 'bareurl', 'bold', 'em', 'strike', 'hl', 'tag', 'br', 'hard', 'nl'):
            if m.group(name) is not None:
                kind = name
                break
        if kind == 'esc':
            out.append(escape(m.group('esc')[1]))
        elif kind == 'code':
            out.append('<code>%s</code>' % escape(m.group('codetext').strip()))
        elif kind == 'math':
            out.append('<code class="math">%s</code>' % escape(m.group('mathtext')))
        elif kind == 'embed':
            out.append(_embed_html(ctx, m.group('embedtarget')))
        elif kind == 'img':
            out.append(_image_html(ctx, m.group('imgsrc'), m.group('imgalt')))
        elif kind == 'wiki':
            out.append(_wikilink_html(ctx, m.group('wikitarget')))
        elif kind == 'fnref':
            fid = m.group('fnid')
            out.append('<a class="fnref" href="#fn-%s"><small>[%s]</small></a>' % (escape(fid), escape(fid)))
        elif kind == 'link':
            href = m.group('linkhref')
            out.append('<a href="%s">%s</a>' % (escape(href), render_inline(m.group('linktext'), ctx) or escape(href)))
        elif kind == 'autolink':
            url = m.group('autourl')
            out.append('<a href="%s">%s</a>' % (escape(url), escape(url)))
        elif kind == 'bareurl':
            url = m.group('bareurl')
            out.append('<a href="%s">%s</a>' % (escape(url), escape(url)))
        elif kind == 'bold':
            inner = m.group('boldtext') if m.group('boldtext') is not None else m.group('boldtext2')
            out.append('<b>%s</b>' % render_inline(inner, ctx))
        elif kind == 'em':
            inner = m.group('emtext') if m.group('emtext') is not None else m.group('emtext2')
            out.append('<i>%s</i>' % render_inline(inner, ctx))
        elif kind == 'strike':
            out.append('<span class="strike">%s</span>' % render_inline(m.group('striketext'), ctx))
        elif kind == 'hl':
            out.append('<span class="hl">%s</span>' % render_inline(m.group('hltext'), ctx))
        elif kind == 'tag':
            name = m.group('tagname')
            out.append('<a class="tag" href="tag:%s">#%s</a>' % (escape(name), escape(name)))
        elif kind in ('br', 'hard', 'nl'):
            out.append('<br>')
        else:
            out.append(escape(m.group(0)))
    return ''.join(out)


# ---- blocks -------------------------------------------------------------------------------------

def section_of(text, heading):
    """Lines of ``text`` under ``heading`` up to the next heading of same or higher level."""
    lines = text.split('\n')
    want = heading.strip().lower()
    start = level = None
    for i, line in enumerate(lines):
        m = _HEADING.match(line)
        if m and strip_markup(m.group(2)).lower() == want:
            start, level = i, len(m.group(1))
            break
    if start is None:
        return text
    end = len(lines)
    for j in range(start + 1, len(lines)):
        m = _HEADING.match(lines[j])
        if m and len(m.group(1)) <= level:
            end = j
            break
    return '\n'.join(lines[start:end])


def _dedent(lines, width):
    out = []
    for line in lines:
        i = 0
        col = 0
        while i < len(line) and col < width and line[i] in ' \t':
            col += 4 if line[i] == '\t' else 1
            i += 1
        out.append(line[i:])
    return out


def _indent_width(line):
    width = 0
    for ch in _INDENT.match(line).group(1):
        width += 4 if ch == '\t' else 1
    return width


def _render_front_matter(lines):
    items = []
    for line in lines:
        m = re.match(r'^([\w.\- ]+):\s*(.*)$', line)
        if m:
            key, value = m.group(1).strip(), m.group(2).strip()
            if value.startswith('[') and value.endswith(']'):
                pills = [v.strip().strip('"\'') for v in value[1:-1].split(',') if v.strip()]
                value_html = ' '.join('<span class="pill">%s</span>' % escape(p) for p in pills)
            else:
                value_html = escape(value.strip('"\''))
            items.append('<div><span class="k">%s</span>&nbsp;&nbsp;%s</div>' % (escape(key), value_html))
        elif line.strip().startswith('- ') and items:
            items[-1] = items[-1][:-len('</div>')] + ' <span class="pill">%s</span></div>' % escape(line.strip()[2:].strip('"\''))
    return '<div class="props">%s</div>' % ''.join(items) if items else ''


def _display_width(text):
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in text)


def _render_table(rows, aligns):
    cells = [[strip_markup(c) for c in r] for r in rows]
    ncol = max(len(r) for r in cells) if cells else 0
    cells = [r + [''] * (ncol - len(r)) for r in cells]
    widths = [max(_display_width(r[i]) for r in cells) for i in range(ncol)]

    def pad(text, i):
        gap = widths[i] - _display_width(text)
        a = aligns[i] if i < len(aligns) else 'left'
        if a == 'right':
            return ' ' * gap + text
        if a == 'center':
            return ' ' * (gap // 2) + text + ' ' * (gap - gap // 2)
        return text + ' ' * gap

    lines = []
    for ri, r in enumerate(cells):
        lines.append('| ' + ' | '.join(pad(c, i) for i, c in enumerate(r)) + ' |')
        if ri == 0:
            lines.append('|' + '|'.join('-' * (widths[i] + 2) for i in range(ncol)) + '|')
    return '<div class="code">%s</div>' % preserve_spaces(escape('\n'.join(lines)))


def _split_row(line):
    line = line.strip()
    if line.startswith('|'):
        line = line[1:]
    if line.endswith('|') and not line.endswith('\\|'):
        line = line[:-1]
    return [c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', line)]


def _render_code(lang, body, ctx):
    lang_l = (lang or '').lower()
    if lang_l == 'mermaid':
        return ('<div class="placeholder">❖ Mermaid diagram – rendered in the iMark browser editor. <a href="%s">Open in iMark</a></div>'
                '<div class="code"><div class="lang">mermaid</div>%s</div>') % (escape(ctx.hint_href), preserve_spaces(escape(body)))
    head = '<div class="lang">%s</div>' % escape(lang) if lang else ''
    return '<div class="code">%s%s</div>' % (head, preserve_spaces(escape(body)))


def _render_math_block(body, ctx):
    return '<div class="placeholder">∑ Math block – typeset in the iMark browser editor. <a href="%s">Open in iMark</a></div><div class="code math">%s</div>' % (escape(ctx.hint_href), preserve_spaces(escape(body)))


def _render_list(items, ordered, ctx):
    html = []
    for content_lines in items:
        task = _TASK.match(content_lines[0])
        if task:
            done = task.group(1).lower() in ('x', '-')
            marker = '<span class="task-done">☑</span> ' if done else '☐ '
            body = _render_blocks_inline_first([task.group(2)] + content_lines[1:], ctx)
            html.append('<li%s>%s%s</li>' % (' class="task-done"' if done else '', marker, body))
        else:
            html.append('<li>%s</li>' % _render_blocks_inline_first(content_lines, ctx))
    tag = 'ol' if ordered else 'ul'
    return '<%s>%s</%s>' % (tag, ''.join(html), tag)


def _render_blocks_inline_first(lines, ctx):
    """List item content: first paragraph inline (no <p>), remaining blocks normally."""
    if not lines:
        return ''
    # Separate the leading paragraph text from nested blocks.
    para = []
    rest_start = len(lines)
    for i, line in enumerate(lines):
        if i == 0:
            para.append(line)
            continue
        if not line.strip() or _LIST.match(line) or _FENCE.match(line) or _QUOTE.match(line) or _HEADING.match(line):
            rest_start = i
            break
        para.append(line)
    head = render_inline('\n'.join(para), ctx)
    rest = lines[rest_start:]
    return head + (render_fragment('\n'.join(rest), ctx) if any(l.strip() for l in rest) else '')


def render_fragment(text, ctx):
    """Render Markdown blocks to minihtml (no <body> / stylesheet)."""
    text = _COMMENT.sub('', _HTML_COMMENT.sub('', text.replace('\r\n', '\n').replace('\r', '\n')))
    lines = text.split('\n')
    out = []
    i = 0
    n = len(lines)

    # front matter (document start only)
    if ctx.depth == 0 and n and lines[0].strip() == '---':
        for j in range(1, n):
            if lines[j].strip() in ('---', '...'):
                out.append(_render_front_matter(lines[1:j]))
                i = j + 1
                break

    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        # fenced code
        fm = _FENCE.match(line)
        if fm:
            fence = fm.group(2)
            lang = fm.group(3)
            body = []
            i += 1
            while i < n:
                close = _FENCE.match(lines[i])
                if close and close.group(2)[0] == fence[0] and len(close.group(2)) >= len(fence) and not close.group(3) and not close.group(4):
                    break
                body.append(lines[i])
                i += 1
            i += 1
            out.append(_render_code(lang, '\n'.join(body), ctx))
            continue
        # math block
        mm = _MATH_FENCE.match(line)
        if mm:
            body = []
            rest = mm.group(1)
            if rest.strip().endswith('$$') and len(rest.strip()) > 2:
                out.append(_render_math_block(rest.strip()[:-2].strip(), ctx))
                i += 1
                continue
            if rest.strip():
                body.append(rest)
            i += 1
            while i < n and not lines[i].strip().startswith('$$') and not lines[i].strip().endswith('$$'):
                body.append(lines[i])
                i += 1
            if i < n:
                tail = lines[i].strip()
                if tail != '$$' and tail.endswith('$$'):
                    body.append(tail[:-2])
                i += 1
            out.append(_render_math_block('\n'.join(body), ctx))
            continue
        # heading
        hm = _HEADING.match(line)
        if hm:
            level = len(hm.group(1))
            out.append('<h%d>%s</h%d>' % (level, render_inline(hm.group(2), ctx), level))
            i += 1
            continue
        # horizontal rule
        if _HR.match(line):
            out.append('<div class="hr">&nbsp;</div>')
            i += 1
            continue
        # blockquote / callout
        qm = _QUOTE.match(line)
        if qm:
            inner = []
            while i < n:
                q = _QUOTE.match(lines[i])
                if q:
                    inner.append(q.group(1))
                elif lines[i].strip() and inner and not _LIST.match(lines[i]) and not _HEADING.match(lines[i]) and not _FENCE.match(lines[i]):
                    inner.append(lines[i])  # lazy continuation
                else:
                    break
                i += 1
            cm = _CALLOUT.match(inner[0]) if inner else None
            if cm:
                kind = cm.group(1).lower()
                color = CALLOUT_COLORS.get(kind, 'bluish')
                title = cm.group(3).strip() or kind.capitalize()
                body = render_fragment('\n'.join(inner[1:]), ctx)
                out.append('<div class="callout callout-%s"><div class="callout-title">%s&nbsp;%s</div>%s</div>' % (color, CALLOUT_ICONS.get(color, 'ⓘ'), render_inline(title, ctx), body))
            else:
                out.append('<div class="quote">%s</div>' % render_fragment('\n'.join(inner), ctx))
            continue
        # footnote definition
        fd = _FOOTNOTE_DEF.match(line)
        if fd:
            body = [fd.group(2)]
            i += 1
            while i < n and lines[i].strip() and _indent_width(lines[i]) >= 2:
                body.append(lines[i].strip())
                i += 1
            ctx.footnotes[fd.group(1)] = render_inline('\n'.join(body), ctx)
            continue
        # table
        if '|' in line and i + 1 < n and _TABLE_SEP.match(lines[i + 1]) and '|' in lines[i + 1]:
            header = _split_row(line)
            aligns = []
            for spec in _split_row(lines[i + 1]):
                s = spec.strip()
                aligns.append('center' if s.startswith(':') and s.endswith(':') else 'right' if s.endswith(':') else 'left')
            rows = [header]
            i += 2
            while i < n and lines[i].strip() and '|' in lines[i]:
                rows.append(_split_row(lines[i]))
                i += 1
            out.append(_render_table(rows, aligns))
            continue
        # list
        lm = _LIST.match(line)
        if lm:
            base_indent = _indent_width(line)
            ordered = lm.group(2)[0].isdigit()
            items = []
            while i < n:
                cur = lines[i]
                if not cur.strip():
                    # blank line: list continues if the next non-blank line is indented or another item
                    j = i + 1
                    while j < n and not lines[j].strip():
                        j += 1
                    if j < n and (_indent_width(lines[j]) > base_indent or (_LIST.match(lines[j]) and _indent_width(lines[j]) == base_indent)):
                        if items and _indent_width(lines[j]) > base_indent:
                            items[-1].append('')
                        i = j
                        continue
                    break
                im = _LIST.match(cur)
                if im and _indent_width(cur) == base_indent and (im.group(2)[0].isdigit() == ordered):
                    content_indent = base_indent + len(im.group(2)) + 1
                    items.append([im.group(3)])
                    items[-1].append(content_indent)  # marker for dedent width (removed below)
                    i += 1
                    continue
                if _indent_width(cur) > base_indent and items:
                    items[-1].append(cur)
                    i += 1
                    continue
                break
            normalised = []
            for it in items:
                first, content_indent, rest = it[0], it[1], it[2:]
                normalised.append([first] + _dedent(rest, content_indent))
            out.append(_render_list(normalised, ordered, ctx))
            continue
        # paragraph
        para = [line]
        i += 1
        while i < n and lines[i].strip() and not _HEADING.match(lines[i]) and not _FENCE.match(lines[i]) and not _QUOTE.match(lines[i]) and not _HR.match(lines[i]) and not _LIST.match(lines[i]) and not _MATH_FENCE.match(lines[i]) and not _FOOTNOTE_DEF.match(lines[i]):
            if '|' in lines[i] and i + 1 < n and _TABLE_SEP.match(lines[i + 1]):
                break
            para.append(lines[i])
            i += 1
        out.append('<p>%s</p>' % render_inline('\n'.join(para), ctx))
    return ''.join(out)


def render_document(text, ctx):
    """Full minihtml document (with stylesheet) for a reading sheet."""
    body = render_fragment(text, ctx)
    if ctx.footnotes:
        notes = ''.join('<div id="fn-%s"><small>[%s]</small> %s</div>' % (escape(k), escape(k), v) for k, v in ctx.footnotes.items())
        body += '<div class="footnotes">%s</div>' % notes
    title = '<div class="imark-title">%s</div>' % escape(ctx.title) if (ctx.title and ctx.show_title) else ''
    return '<body id="imark-preview"><style>%s</style>%s%s</body>' % (stylesheet(ctx.font_face), title, body)


def render_popup(text, ctx, max_lines=14):
    """Compact fragment for hover popups: the first ``max_lines`` lines."""
    lines = text.replace('\r\n', '\n').split('\n')
    clipped = lines[:max_lines]
    more = len(lines) > max_lines
    html = render_fragment('\n'.join(clipped), ctx)
    if more:
        html += '<p><small>…</small></p>'
    return '<body id="imark-popup"><style>%s body { padding: 0.4rem 0.8rem; }</style>%s</body>' % (stylesheet(ctx.font_face), html)
