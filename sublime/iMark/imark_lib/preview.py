"""In-Sublime preview built on minihtml (no browser needed):

- a read-only *reading sheet* in the right-hand group that follows the active
  Markdown view and re-renders as you type;
- inline phantoms in Markdown buffers: images below image links and a hint
  under Mermaid blocks;
- hover popups for wikilinks (note excerpt), images, links and footnotes.

minihtml cannot run scripts or CSS beyond a small subset, so this is a
lower-fidelity companion to the browser editor, not a replacement. Everything
here runs on the main thread (rendering is pure Python and fast for notes)."""
import os
import re
import urllib.parse
import urllib.request

import sublime

from . import imgsize, util
from .files import open_views_text
from .links import MD_EXT, parse_target
from .markdown_min import DISPLAYABLE_EXT, RenderContext, escape, render_document, render_popup, stylesheet

PREVIEW_SETTING = 'imark_preview'
PHANTOM_KEY_SHEET = 'imark-reading'
PHANTOM_KEY_INLINE = 'imark-inline'

IMAGE_LINK = re.compile(r'!\[\[(?P<embed>[^\]]+)\]\]|!\[(?P<alt>[^\]]*)\]\((?P<src>[^)\s]+)(?:\s+"[^"]*")?\)')
WIKILINK = re.compile(r'(?P<bang>!?)\[\[(?P<target>[^\]]+)\]\]')
MDLINK = re.compile(r'(?<!!)\[(?P<text>[^\]]*)\]\((?P<href>[^)\s]+)(?:\s+"[^"]*")?\)')
FNREF = re.compile(r'\[\^(?P<id>[^\]]+)\](?!:)')
MERMAID = re.compile(r'^ {0,3}(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n.*?^ {0,3}\1[ \t]*$', re.MULTILINE | re.DOTALL)
_SCHEME = re.compile(r'^[a-z][a-z0-9+.-]*:', re.IGNORECASE)
OPEN_EXTERNALLY = frozenset({'.pdf', '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.mp4', '.webm', '.mov', '.mkv'})

LAYOUT_TWO_COLUMNS = {'cols': [0.0, 0.5, 1.0], 'rows': [0.0, 1.0], 'cells': [[0, 0, 1, 1], [1, 0, 2, 1]]}
LAYOUT_ONE = {'cols': [0.0, 1.0], 'rows': [0.0, 1.0], 'cells': [[0, 0, 1, 1]]}
MAX_INLINE_IMAGES = 60


def file_url(path):
    url = urllib.request.pathname2url(os.path.abspath(path))
    if not url.startswith('///'):
        url = '//' + url if url.startswith('/') else '///' + url
    return 'file:' + url


def is_preview_view(view):
    try:
        return bool(view is not None and view.settings().get(PREVIEW_SETTING))
    except Exception:  # pylint: disable=broad-except
        return False


class Host:
    """Renderer callbacks bound to a Markdown source view (paths, images, notes)."""

    def __init__(self, manager, view):
        self.manager = manager
        self.view = view
        self.file = view.file_name()
        self.doc_dir = os.path.dirname(self.file) if self.file else None
        self.roots = manager.sync.files.roots_for(view)

    def resolve_path(self, target):
        """Absolute path for a relative / absolute / wikilink-style target, or None."""
        if not target:
            return None
        if _SCHEME.match(target) and not target.lower().startswith('file:'):
            return None
        if target.lower().startswith('file:'):
            p = urllib.request.url2pathname(urllib.parse.urlsplit(target).path)
            return p if os.path.exists(p) else None
        p = urllib.parse.unquote(target.split('#')[0].split('?')[0])
        if os.path.isabs(p) and os.path.exists(p):
            return p
        if self.doc_dir:
            candidate = os.path.normpath(os.path.join(self.doc_dir, p))
            if os.path.exists(candidate):
                return candidate
        if self.file and self.roots:
            hit = self.manager.sync.files.resolve_in(self.file, self.roots, p)
            if hit and os.path.exists(hit):
                return hit
        return None

    def resolve_image(self, src):
        path = self.resolve_path(src)
        if not path or not DISPLAYABLE_EXT.search(path) or not os.path.isfile(path):
            return None
        size = imgsize.image_size(path) or (None, None)
        return {'url': file_url(path), 'path': path, 'width': size[0], 'height': size[1]}

    def resolve_note(self, target):
        return self.resolve_path(target)

    def read_note(self, target):
        path = self.resolve_path(target)
        if not path or not MD_EXT.search(path):
            return None
        text = open_views_text(path)
        if text is None:
            try:
                with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                    text = fh.read()
            except OSError:
                return None
        return text

    def context(self, **kwargs):
        opts = self.manager.settings()
        params = {
            'resolve_image': self.resolve_image,
            'resolve_note': self.resolve_note,
            'read_note': self.read_note,
            'font_face': self.view.settings().get('font_face') or None,
            'max_image_width': opts['max_image_width'],
        }
        params.update(kwargs)
        return RenderContext(**params)


class ReadingSheet:
    """One per window: a scratch view holding the rendered document as a phantom."""

    def __init__(self, manager, window):
        self.manager = manager
        self.window = window
        self.preview = None
        self.phantoms = None
        self.source_id = None
        self.created_layout = False
        self.group = -1
        self.last_html = None
        self.large = False
        self._serial = 0

    # ---- lifecycle -------------------------------------------------------------------------

    def open(self, source_view):
        window = self.window
        if window.num_groups() == 1:
            window.set_layout(LAYOUT_TWO_COLUMNS)
            self.created_layout = True
        src_group, _ = window.get_view_index(source_view)
        if src_group < 0:
            src_group = window.active_group()
        group = src_group + 1 if src_group + 1 < window.num_groups() else max(0, src_group - 1)
        window.focus_group(group)
        preview = window.new_file()
        preview.set_scratch(True)
        s = preview.settings()
        s.set(PREVIEW_SETTING, True)
        for key, value in (('gutter', False), ('line_numbers', False), ('draw_indent_guides', False), ('highlight_line', False), ('word_wrap', True),
                           ('scroll_past_end', False), ('draw_white_space', 'none'), ('rulers', []), ('fold_buttons', False), ('spell_check', False),
                           ('draw_centered', False), ('auto_complete', False)):
            s.set(key, value)
        preview.run_command('append', {'characters': ' '})  # the phantom needs a position to hang from
        preview.set_read_only(True)
        current_group, _ = window.get_view_index(preview)
        if current_group != group:
            window.set_view_index(preview, group, len(window.views_in_group(group)))
        self.preview = preview
        self.group = group
        self.phantoms = sublime.PhantomSet(preview, PHANTOM_KEY_SHEET)
        window.focus_view(source_view)
        self.bind(source_view)
        self.refresh(force=True)
        util.log('reading sheet opened: preview view %d in group %d of %d (layout created: %s)', preview.id(), group, window.num_groups(), self.created_layout)

    def alive(self):
        return self.preview is not None and self.preview.is_valid()

    def is_preview(self, view):
        return self.preview is not None and view is not None and view.id() == self.preview.id()

    def bind(self, source_view):
        if source_view.id() != self.source_id:
            self.source_id = source_view.id()
            self.last_html = None
            self.large = False

    def source_view(self):
        for v in self.window.views():
            if v.id() == self.source_id and v.is_valid():
                return v
        return None

    def close(self):
        preview = self.preview
        self.preview = None
        if preview is not None and preview.is_valid():
            preview.close()
        self.on_preview_closed()

    def on_preview_closed(self):
        self.preview = None
        self.phantoms = None
        window = self.window
        try:
            if self.created_layout and window.num_groups() == 2 and not window.views_in_group(self.group):
                window.set_layout(LAYOUT_ONE)
        except Exception:  # pylint: disable=broad-except
            util.log_exception('restore layout')
        self.created_layout = False

    # ---- rendering -----------------------------------------------------------------------------

    def schedule(self, delay_ms):
        self._serial += 1
        serial = self._serial

        def fire():
            if serial == self._serial:
                self.refresh()

        sublime.set_timeout(fire, delay_ms)

    def refresh(self, force=False):
        if not self.alive():
            return
        view = self.source_view()
        if view is None:
            return
        opts = self.manager.settings()
        text = util.view_text(view)
        self.large = len(text) > opts['max_size_kb'] * 1024
        if self.large and not force:
            return
        title = MD_EXT.sub('', os.path.basename(view.file_name() or '')) or (view.name() or 'untitled')
        host = Host(self.manager, view)
        try:
            html = render_document(text, host.context(title=title, show_title=opts['show_title']))
        except Exception:  # pylint: disable=broad-except
            util.log_exception('render reading sheet')
            html = '<body><style>%s</style><p>iMark could not render this document. See the console for details.</p></body>' % stylesheet()
        if self.large:
            html = html.replace('<body id="imark-preview">', '<body id="imark-preview"><div class="placeholder">Large document: the reading sheet refreshes on save.</div>', 1)
        if html == self.last_html:
            return
        self.last_html = html
        manager = self.manager
        self.phantoms.update([sublime.Phantom(sublime.Region(0), html, sublime.LAYOUT_BLOCK, lambda href: manager.navigate(view, href))])
        self.preview.set_name('iMark · %s' % title)
        util.log('reading sheet rendered %s: %d chars of minihtml (source view %d, large=%s)', title, len(html), view.id(), self.large)


class PreviewManager:
    def __init__(self, sync_manager):
        self.sync = sync_manager
        self.sheets = {}          # window id -> ReadingSheet
        self._inline_sets = {}    # view id -> PhantomSet
        self._inline_serial = {}  # view id -> int
        self._inline_stamp = {}   # view id -> change_count rendered

    # ---- settings ---------------------------------------------------------------------------------

    def settings(self):
        get = util.setting
        return {
            'inline_images': bool(get('preview.inline_images', True)),
            'block_hints': bool(get('preview.block_hints', True)),
            'hover_popups': bool(get('preview.hover_popups', True)),
            'max_image_width': int(get('preview.max_image_width', 640) or 640),
            'refresh_delay_ms': int(get('preview.refresh_delay_ms', 200) or 200),
            'max_size_kb': int(get('preview.max_size_kb', 512) or 512),
            'show_title': bool(get('preview.show_title', True)),
        }

    # ---- reading sheet ----------------------------------------------------------------------------

    def sheet_for_window(self, window):
        if window is None:
            return None
        sheet = self.sheets.get(window.id())
        if sheet is not None and not sheet.alive():
            self.sheets.pop(window.id(), None)
            return None
        return sheet

    def has_sheet(self, window):
        return self.sheet_for_window(window) is not None

    def toggle_sheet(self, view):
        if view is None:
            return False
        window = view.window() or sublime.active_window()
        if window is None:
            return False
        sheet = self.sheet_for_window(window)
        if sheet is not None:
            sheet.close()
            self.sheets.pop(window.id(), None)
            util.log('reading sheet closed (window %d)', window.id())
            return False
        if is_preview_view(view) or not util.is_markdown_view(view):
            sublime.status_message('iMark: open a Markdown file to show the reading sheet')
            return False
        sheet = ReadingSheet(self, window)
        self.sheets[window.id()] = sheet
        sheet.open(view)
        return True

    def refresh_sheets(self, force=False):
        for sheet in list(self.sheets.values()):
            if sheet.alive():
                sheet.last_html = None
                sheet.refresh(force=force)

    # ---- navigation (sheet, popups, hints) ----------------------------------------------------------

    def navigate(self, view, href):
        try:
            self._navigate(view, href)
        except Exception:  # pylint: disable=broad-except
            util.log_exception('navigate %s' % href)

    def _navigate(self, view, href):
        if not view.is_valid():
            return
        window = view.window() or sublime.active_window()
        if href == 'imark:open':
            self.sync.open(view)
            return
        if href.startswith('wiki:'):
            target = parse_target(href[len('wiki:'):])
            if not target.path:
                return
            path = Host(self, view).resolve_note(target.path)
            if not path:
                sublime.status_message('iMark: "%s" does not exist yet – follow the link in the browser editor to create it' % target.path)
                return
            self._open_path(window, path)
            return
        if href.startswith('tag:'):
            self.sync.search_tag(view, href[len('tag:'):])
            return
        if href.startswith('#'):
            return
        if _SCHEME.match(href) and not href.lower().startswith('file:'):
            util.open_external(href)
            return
        path = Host(self, view).resolve_path(href)
        if path:
            self._open_path(window, path)
        else:
            sublime.status_message('iMark: not found: %s' % href)

    def _open_path(self, window, path):
        if os.path.splitext(path)[1].lower() in OPEN_EXTERNALLY:
            util.open_external(file_url(path))
            return
        if window is not None:
            window.open_file(path)

    # ---- inline decorations -----------------------------------------------------------------------------

    def refresh_inline(self, view, immediate=False):
        if view is None or not view.is_valid() or is_preview_view(view) or not util.is_markdown_view(view):
            return
        opts = self.settings()
        if not opts['inline_images'] and not opts['block_hints']:
            self.clear_inline(view)
            return
        if immediate:
            self._apply_inline(view, opts)
            return
        vid = view.id()
        self._inline_serial[vid] = self._inline_serial.get(vid, 0) + 1
        serial = self._inline_serial[vid]

        def fire():
            if serial == self._inline_serial.get(vid) and view.is_valid():
                self._apply_inline(view, self.settings())

        sublime.set_timeout(fire, max(50, opts['refresh_delay_ms']))

    def clear_inline(self, view):
        ps = self._inline_sets.pop(view.id(), None)
        if ps is not None:
            ps.update([])
        self._inline_stamp.pop(view.id(), None)

    def _apply_inline(self, view, opts):
        stamp = (view.change_count(), opts['inline_images'], opts['block_hints'], opts['max_image_width'])
        if self._inline_stamp.get(view.id()) == stamp:
            return
        text = util.view_text(view)
        if len(text) > opts['max_size_kb'] * 1024:
            self.clear_inline(view)
            return
        host = Host(self, view)
        phantoms = []
        nav = lambda href, v=view: self.navigate(v, href)  # noqa: E731
        if opts['inline_images']:
            count = 0
            for m in IMAGE_LINK.finditer(text):
                src = parse_target(m.group('embed')).path if m.group('embed') else m.group('src')
                width_hint = parse_target(m.group('embed')).width if m.group('embed') else None
                info = host.resolve_image(src)
                if not info:
                    continue
                w, h = info['width'], info['height']
                if width_hint and w and h:
                    w, h = width_hint, int(round(h * width_hint / float(w)))
                w, h = imgsize.fit(w, h, opts['max_image_width'])
                attrs = (' width="%d"' % w if w else '') + (' height="%d"' % h if h else '')
                html = '<body id="imark-inline"><style>body { margin: 0; padding: 0.25rem 0 0.35rem 0; }</style><a href="%s"><img src="%s"%s></a></body>' % (
                    escape(file_url(info['path'])), escape(info['url']), attrs)
                phantoms.append(sublime.Phantom(sublime.Region(view.line(m.end()).end()), html, sublime.LAYOUT_BLOCK, nav))
                count += 1
                if count >= MAX_INLINE_IMAGES:
                    break
        if opts['block_hints']:
            for m in MERMAID.finditer(text):
                html = ('<body id="imark-hint"><style>body { margin: 0; padding: 0.15rem 0 0.35rem 0; } .hint { font-size: 0.85rem; color: color(var(--foreground) alpha(0.65)); '
                        'border: 1px solid color(var(--foreground) alpha(0.2)); border-radius: 0.3rem; padding: 0.2rem 0.6rem; } a { color: var(--accent); text-decoration: none; }</style>'
                        '<div class="hint">❖ Mermaid diagram · rendered in the iMark browser editor · <a href="imark:open">Open in iMark</a></div></body>')
                phantoms.append(sublime.Phantom(sublime.Region(view.line(m.end()).end()), html, sublime.LAYOUT_BLOCK, nav))
        ps = self._inline_sets.get(view.id())
        if ps is None:
            ps = sublime.PhantomSet(view, PHANTOM_KEY_INLINE)
            self._inline_sets[view.id()] = ps
        ps.update(phantoms)
        self._inline_stamp[view.id()] = stamp
        if phantoms:
            util.log('inline phantoms for view %d: %d', view.id(), len(phantoms))

    # ---- hover popups -------------------------------------------------------------------------------------

    def on_hover(self, view, point, hover_zone):
        try:
            if hover_zone != sublime.HOVER_TEXT or is_preview_view(view) or not util.is_markdown_view(view):
                return
            if not self.settings()['hover_popups']:
                return
            html = self.hover_html(view, point)
            if html:
                view.show_popup(html, sublime.HIDE_ON_MOUSE_MOVE_AWAY, point, max_width=680, max_height=520, on_navigate=lambda href: self.navigate(view, href))
        except Exception:  # pylint: disable=broad-except
            util.log_exception('hover popup')

    def hover_html(self, view, point):
        """Popup HTML for the link under ``point`` (or None)."""
        line = view.line(point)
        text = view.substr(line)
        col = point - line.begin()
        host = Host(self, view)
        style = '<style>%s body { padding: 0.4rem 0.8rem; } .head { font-size: 0.85rem; color: color(var(--foreground) alpha(0.6)); margin-bottom: 0.3rem; }</style>' % stylesheet(view.settings().get('font_face') or None)
        for m in WIKILINK.finditer(text):
            if not m.start() <= col <= m.end():
                continue
            target = parse_target(m.group('target'))
            if not target.path:
                return None
            image = host.resolve_image(target.path) if DISPLAYABLE_EXT.search(target.path) or m.group('bang') else None
            if image:
                return self._image_popup(style, image, target.path, target.width)
            note = host.read_note(target.path)
            if note is None:
                path = host.resolve_note(target.path)
                if path:
                    return '<body>%s<div class="head">File</div><a href="wiki:%s">%s</a></body>' % (style, escape(target.path), escape(os.path.basename(path)))
                return '<body>%s<div class="head">Unresolved link</div><span class="img-missing">%s</span></body>' % (style, escape(target.path))
            ctx = host.context(depth=1, title=None, show_title=False)
            body = render_popup(note, ctx)
            head = '<div class="head">Note · <a href="wiki:%s">Open in Sublime Text</a></div>' % escape(m.group('target'))
            return body.replace('<body id="imark-popup">', '<body id="imark-popup">' + head, 1)
        for m in IMAGE_LINK.finditer(text):
            if m.group('embed') is None and m.start() <= col <= m.end():
                image = host.resolve_image(m.group('src'))
                if image:
                    return self._image_popup(style, image, m.group('src'), None)
                return None
        for m in MDLINK.finditer(text):
            if m.start() <= col <= m.end():
                href = m.group('href')
                label = 'Link' if _SCHEME.match(href) else 'File'
                return '<body>%s<div class="head">%s</div><a href="%s">%s</a></body>' % (style, label, escape(href), escape(href))
        for m in FNREF.finditer(text):
            if m.start() <= col <= m.end():
                fid = m.group('id')
                whole = util.view_text(view)
                dm = re.search(r'^\[\^%s\]:[ \t]*(.*)$' % re.escape(fid), whole, re.MULTILINE)
                if not dm:
                    return None
                from .markdown_min import render_inline  # pylint: disable=import-outside-toplevel
                ctx = host.context(depth=1)
                return '<body>%s<div class="head">Footnote [%s]</div><p>%s</p></body>' % (style, escape(fid), render_inline(dm.group(1), ctx))
        return None

    def _image_popup(self, style, image, label, width_hint):
        w, h = image['width'], image['height']
        if width_hint and w and h:
            w, h = width_hint, int(round(h * width_hint / float(w)))
        w, h = imgsize.fit(w, h, 420)
        attrs = (' width="%d"' % w if w else '') + (' height="%d"' % h if h else '')
        size = ' · %d×%d' % (image['width'], image['height']) if image['width'] and image['height'] else ''
        return '<body>%s<div class="head">%s%s</div><img src="%s"%s></body>' % (style, escape(label), size, escape(image['url']), attrs)

    # ---- events ------------------------------------------------------------------------------------------

    def on_modified(self, view):
        if is_preview_view(view) or not util.is_markdown_view(view):
            return
        sheet = self.sheet_for_window(view.window())
        if sheet is not None and sheet.source_id == view.id():
            sheet.schedule(self.settings()['refresh_delay_ms'])
        self.refresh_inline(view)

    def on_activated(self, view):
        if view is None or not view.is_valid() or is_preview_view(view) or not util.is_markdown_view(view):
            return
        sheet = self.sheet_for_window(view.window())
        if sheet is not None and sheet.source_id != view.id():
            sheet.bind(view)
            sheet.refresh(force=True)
        if view.id() not in self._inline_stamp:
            self.refresh_inline(view, immediate=True)

    def on_load(self, view):
        if util.is_markdown_view(view) and not is_preview_view(view):
            self.refresh_inline(view, immediate=True)

    def on_post_save(self, view):
        sheet = self.sheet_for_window(view.window())
        if sheet is not None and sheet.source_id == view.id():
            sheet.refresh(force=True)
        self.refresh_inline(view)

    def on_close(self, view):
        for wid, sheet in list(self.sheets.items()):
            if sheet.is_preview(view):
                sheet.on_preview_closed()
                self.sheets.pop(wid, None)
        self._inline_sets.pop(view.id(), None)
        self._inline_serial.pop(view.id(), None)
        self._inline_stamp.pop(view.id(), None)

    def on_settings_changed(self):
        self.refresh_sheets(force=True)
        for window in sublime.windows():
            for view in window.views():
                if util.is_markdown_view(view) and not is_preview_view(view):
                    self._inline_stamp.pop(view.id(), None)
                    self.refresh_inline(view)

    def shutdown(self):
        for sheet in list(self.sheets.values()):
            try:
                sheet.close()
            except Exception:  # pylint: disable=broad-except
                pass
        self.sheets.clear()
        for ps in self._inline_sets.values():
            try:
                ps.update([])
            except Exception:  # pylint: disable=broad-except
                pass
        self._inline_sets.clear()
        self._inline_stamp.clear()
