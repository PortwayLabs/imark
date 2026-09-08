"""A small stand-in for Sublime Text's ``sublime`` module, enough to run the
iMark package outside Sublime Text (unit tests and the standalone dev server).

Main-thread semantics: ``set_timeout`` queues callbacks that run when the test /
runner calls ``pump()`` (or ``run_forever()``), mirroring Sublime's UI thread."""
import heapq
import itertools
import os
import re
import sys
import tempfile
import threading
import time

import sublime_plugin  # pylint: disable=import-error

# ---- constants ----------------------------------------------------------------------------

LITERAL = 1
IGNORECASE = 2
DIALOG_CANCEL = 0
DIALOG_YES = 1
DIALOG_NO = 2
KIND_ID_AMBIGUOUS = 0
KIND_ID_COLOR_PURPLISH = 4
KIND_AMBIGUOUS = (KIND_ID_AMBIGUOUS, '', '')
ENCODED_POSITION = 1
TRANSIENT = 4
LAYOUT_INLINE = 0
LAYOUT_BELOW = 1
LAYOUT_BLOCK = 2
HOVER_TEXT = 1
HOVER_GUTTER = 2
HOVER_MARGIN = 3
COOPERATE_WITH_AUTO_COMPLETE = 2
HIDE_ON_MOUSE_MOVE = 4
HIDE_ON_MOUSE_MOVE_AWAY = 8
KEEP_ON_SELECTION_MODIFIED = 16
HIDE_ON_CHARACTER_EVENT = 32
DRAW_NO_FILL = 32
DRAW_NO_OUTLINE = 256
HIDDEN = 128
PERSISTENT = 16

_BASE = os.environ.get('IMARK_FAKE_SUBLIME_HOME') or tempfile.mkdtemp(prefix='imark-fake-sublime-')
_PACKAGES = os.environ.get('IMARK_FAKE_PACKAGES') or os.path.join(_BASE, 'Packages')
_CACHE = os.path.join(_BASE, 'Cache')
_INSTALLED = os.path.join(_BASE, 'Installed Packages')
for _d in (_PACKAGES, _CACHE, _INSTALLED, os.path.join(_PACKAGES, 'User')):
    os.makedirs(_d, exist_ok=True)

messages = []  # status / error messages, for assertions
clipboard = ['']
dialog_answers = {'ok_cancel': True, 'yes_no_cancel': DIALOG_YES}


def version():
    return '4200'


def platform():
    return {'darwin': 'osx', 'win32': 'windows'}.get(sys.platform, 'linux')


def arch():
    return 'x64'


def packages_path():
    return _PACKAGES


def installed_packages_path():
    return _INSTALLED


def cache_path():
    return _CACHE


def executable_path():
    return '/Applications/Sublime Text.app/Contents/MacOS/sublime_text' if sys.platform == 'darwin' else '/usr/bin/subl'


# ---- main thread scheduler --------------------------------------------------------------------

_timers = []
_timer_lock = threading.Condition()
_counter = itertools.count()
_main_thread = threading.current_thread()


def set_timeout(callback, delay=0):
    with _timer_lock:
        heapq.heappush(_timers, (time.monotonic() + delay / 1000.0, next(_counter), callback))
        _timer_lock.notify_all()


def set_timeout_async(callback, delay=0):
    def run():
        if delay:
            time.sleep(delay / 1000.0)
        callback()

    threading.Thread(target=run, daemon=True).start()


def pump(seconds=0.05):
    """Run due callbacks for ``seconds`` (main thread)."""
    deadline = time.monotonic() + seconds
    while True:
        with _timer_lock:
            now = time.monotonic()
            if _timers and _timers[0][0] <= now:
                _, _, cb = heapq.heappop(_timers)
            else:
                cb = None
                wait = min(deadline, _timers[0][0]) - now if _timers else deadline - now
                if wait <= 0:
                    return
                _timer_lock.wait(wait)
        if cb is not None:
            cb()
        if time.monotonic() >= deadline:
            return


def pump_until(predicate, timeout=5.0, step=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pump(step)
        if predicate():
            return True
    return bool(predicate())


def run_forever():
    while True:
        pump(0.5)


# ---- settings -----------------------------------------------------------------------------------

class Settings:
    def __init__(self, name):
        self.name = name
        self._data = {}
        self._callbacks = {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value
        for cb in list(self._callbacks.values()):
            cb()

    def erase(self, key):
        self._data.pop(key, None)

    def has(self, key):
        return key in self._data

    def add_on_change(self, tag, callback):
        self._callbacks[tag] = callback

    def clear_on_change(self, tag):
        self._callbacks.pop(tag, None)

    def to_dict(self):
        return dict(self._data)

    def update(self, values):
        self._data.update(values)


_settings = {}


def load_settings(name):
    s = _settings.get(name)
    if s is None:
        s = Settings(name)
        _settings[name] = s
        # Load defaults from a package file if present (Packages/*/<name>).
        for pkg in sorted(os.listdir(_PACKAGES)):
            p = os.path.join(_PACKAGES, pkg, name)
            if os.path.isfile(p):
                try:
                    s.update(_load_json_with_comments(p))
                except ValueError:
                    pass
    return s


def save_settings(name):
    pass


def _load_json_with_comments(path):
    import json  # pylint: disable=import-outside-toplevel
    with open(path, 'r', encoding='utf-8') as fh:
        text = fh.read()
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return json.loads(text)


# ---- resources ---------------------------------------------------------------------------------------

def _resource_path(name):
    assert name.startswith('Packages/'), name
    return os.path.join(_PACKAGES, *name[len('Packages/'):].split('/'))


def load_resource(name):
    with open(_resource_path(name), 'r', encoding='utf-8') as fh:
        return fh.read()


def load_binary_resource(name):
    with open(_resource_path(name), 'rb') as fh:
        return fh.read()


def find_resources(pattern):
    import fnmatch  # pylint: disable=import-outside-toplevel
    out = []
    for current, _dirs, files in os.walk(_PACKAGES):
        for f in files:
            if fnmatch.fnmatch(f, pattern):
                rel = os.path.relpath(os.path.join(current, f), _PACKAGES).replace(os.sep, '/')
                out.append('Packages/' + rel)
    return out


# ---- UI ------------------------------------------------------------------------------------------------

def status_message(msg):
    messages.append(('status', msg))


def error_message(msg):
    messages.append(('error', msg))


def message_dialog(msg):
    messages.append(('dialog', msg))


def ok_cancel_dialog(msg, ok_title='', title=''):  # pylint: disable=unused-argument
    messages.append(('ok_cancel', msg))
    return dialog_answers['ok_cancel']


def yes_no_cancel_dialog(msg, yes_title='', no_title='', title=''):  # pylint: disable=unused-argument
    messages.append(('yes_no_cancel', msg))
    return dialog_answers['yes_no_cancel']


def set_clipboard(text):
    clipboard[0] = text


def get_clipboard():
    return clipboard[0]


def select_folder_dialog(callback, directory=None, multi_select=False):  # pylint: disable=unused-argument
    callback(None)


def open_dialog(callback, file_types=None, directory=None, multi_select=False, allow_folders=False):  # pylint: disable=unused-argument
    callback(None)


class QuickPanelItem:
    def __init__(self, trigger, details='', annotation='', kind=KIND_AMBIGUOUS):
        self.trigger = trigger
        self.details = details
        self.annotation = annotation
        self.kind = kind

    def __repr__(self):
        return 'QuickPanelItem(%r)' % self.trigger


# ---- text model ------------------------------------------------------------------------------------------

class Region:
    __slots__ = ('a', 'b', 'xpos')

    def __init__(self, a, b=None, xpos=-1):
        self.a = a
        self.b = a if b is None else b
        self.xpos = xpos

    def begin(self):
        return min(self.a, self.b)

    def end(self):
        return max(self.a, self.b)

    def size(self):
        return self.end() - self.begin()

    def empty(self):
        return self.a == self.b

    def contains(self, x):
        if isinstance(x, Region):
            return self.begin() <= x.begin() and x.end() <= self.end()
        return self.begin() <= x <= self.end()

    def __eq__(self, other):
        return isinstance(other, Region) and self.a == other.a and self.b == other.b

    def __hash__(self):
        return hash((self.a, self.b))

    def __repr__(self):
        return 'Region(%d, %d)' % (self.a, self.b)


class Selection(list):
    def clear(self):
        del self[:]

    def add(self, region):
        if isinstance(region, int):
            region = Region(region)
        self.append(region)

    def add_all(self, regions):
        for r in regions:
            self.add(r)


class Edit:
    def __init__(self, view):
        self.view = view


class Phantom:
    def __init__(self, region, content, layout, on_navigate=None):
        self.region = region
        self.content = content
        self.layout = layout
        self.on_navigate = on_navigate

    def __repr__(self):
        return 'Phantom(%r, layout=%d, %d chars)' % (self.region, self.layout, len(self.content))


class PhantomSet:
    def __init__(self, view, key=''):
        self.view = view
        self.key = key
        self.phantoms = []
        view._phantom_sets[key] = self  # pylint: disable=protected-access

    def update(self, phantoms):
        self.phantoms = list(phantoms)

    def __del__(self):
        pass


_view_ids = itertools.count(1)
_window_ids = itertools.count(1)

DEFAULT_STYLE = {
    'background': '#272822',
    'foreground': '#f8f8f2',
    'caret': '#f8f8f0',
    'line_highlight': '#3e3d32',
    'selection': '#49483e',
    'accent': '#66d9ef',
    'gutter': '#272822',
    'gutter_foreground': '#90908a',
    'find_highlight': '#ffe792',
    'guide': '#464741',
}
SCOPE_COLORS = {
    'keyword': '#f92672',
    'string': '#e6db74',
    'comment': '#75715e',
    'entity.name.function': '#a6e22e',
    'constant.numeric': '#ae81ff',
    'constant.language': '#ae81ff',
    'variable.other.member': '#f8f8f2',
    'entity.name.tag': '#f92672',
    'keyword.operator': '#f92672',
    'markup.underline.link': '#66d9ef',
    'invalid.illegal': '#f8f8f0',
}


class View:
    def __init__(self, window, file_name=None, text='', syntax=None):
        self._id = next(_view_ids)
        self._window = window
        self._file = file_name
        self._text = text
        self._valid = True
        self._loading = False
        self._read_only = False
        self._dirty = False
        self._scratch = False
        self._name = None
        self._settings = Settings('view')
        self._settings.update({'tab_size': 4, 'translate_tabs_to_spaces': True, 'color_scheme': 'Monokai.sublime-color-scheme', 'font_face': 'Menlo'})
        self._status = {}
        self._syntax = syntax or ('Packages/Markdown/Markdown.sublime-syntax' if (file_name or '').lower().endswith(('.md', '.markdown')) else 'Packages/Text/Plain text.tmLanguage')
        self._sel = Selection([Region(0)])
        self._change_count = 0
        self._phantom_sets = {}
        self._regions = {}
        self._viewport = (0.0, 0.0)
        self.popups = []
        self.popup_visible = False
        self.style_overrides = dict(DEFAULT_STYLE)

    # identity
    def id(self):
        return self._id

    def window(self):
        return self._window

    def file_name(self):
        return self._file

    def is_valid(self):
        return self._valid

    def is_loading(self):
        return self._loading

    def is_read_only(self):
        return self._read_only

    def set_read_only(self, value):
        self._read_only = value

    def is_dirty(self):
        return self._dirty

    def is_scratch(self):
        return self._scratch

    def set_scratch(self, value):
        self._scratch = value

    def name(self):
        return self._name

    def set_name(self, name):
        self._name = name

    def settings(self):
        return self._settings

    def change_count(self):
        return self._change_count

    def match_selector(self, pt, selector):  # pylint: disable=unused-argument
        return 'markdown' in self._syntax.lower() and 'markdown' in selector

    def viewport_extent(self):
        return (800.0, 600.0)

    def viewport_position(self):
        return self._viewport

    def set_viewport_position(self, pos, animate=True):  # pylint: disable=unused-argument
        self._viewport = pos

    # text
    def size(self):
        return len(self._text)

    def substr(self, x):
        if isinstance(x, Region):
            return self._text[x.begin():x.end()]
        return self._text[x:x + 1]

    def sel(self):
        return self._sel

    def line(self, x):
        pt = x.begin() if isinstance(x, Region) else x
        pt = max(0, min(pt, len(self._text)))
        start = self._text.rfind('\n', 0, pt) + 1
        end = self._text.find('\n', pt)
        if end < 0:
            end = len(self._text)
        if isinstance(x, Region) and x.end() > end:
            end = self.line(x.end()).end()
        return Region(start, end)

    def full_line(self, x):
        r = self.line(x)
        return Region(r.a, min(len(self._text), r.b + 1))

    def lines(self, region):
        out = []
        pos = region.begin()
        while True:
            r = self.line(pos)
            out.append(r)
            if r.end() >= region.end() or r.end() >= len(self._text):
                break
            pos = r.end() + 1
        return out

    def text_point(self, row, col):
        lines = self._text.split('\n')
        return sum(len(l) + 1 for l in lines[:row]) + col

    def rowcol(self, pt):
        before = self._text[:pt]
        row = before.count('\n')
        col = pt - (before.rfind('\n') + 1)
        return row, col

    def find(self, pattern, start_pt, flags=0):
        if flags & LITERAL:
            idx = self._text.find(pattern, start_pt)
            return Region(idx, idx + len(pattern)) if idx >= 0 else Region(-1, -1)
        m = re.compile(pattern).search(self._text, start_pt)
        return Region(m.start(), m.end()) if m else Region(-1, -1)

    def find_all(self, pattern, flags=0):
        if flags & LITERAL:
            return [Region(m.start(), m.end()) for m in re.finditer(re.escape(pattern), self._text)]
        return [Region(m.start(), m.end()) for m in re.finditer(pattern, self._text, re.MULTILINE)]

    def _mutate(self, start, end, text):
        if self._read_only:
            return
        self._text = self._text[:start] + text + self._text[end:]
        self._dirty = True
        self._change_count += 1
        sublime_plugin.dispatch_event('on_modified', self)

    def replace(self, edit, region, text):
        assert isinstance(edit, Edit)
        self._mutate(region.begin(), region.end(), text)

    def insert(self, edit, pt, text):
        assert isinstance(edit, Edit)
        self._mutate(pt, pt, text)
        return len(text)

    def erase(self, edit, region):
        assert isinstance(edit, Edit)
        self._mutate(region.begin(), region.end(), '')

    def set_text(self, text):
        """Test helper: simulate typing in Sublime Text (fires on_modified)."""
        self._mutate(0, len(self._text), text)

    # decorations / popups
    def add_regions(self, key, regions, scope='', icon='', flags=0):  # pylint: disable=unused-argument
        self._regions[key] = list(regions)

    def erase_regions(self, key):
        self._regions.pop(key, None)

    def get_regions(self, key):
        return list(self._regions.get(key, []))

    def show_popup(self, content, flags=0, location=-1, max_width=320, max_height=240, on_navigate=None, on_hide=None):  # pylint: disable=too-many-arguments
        self.popups.append({'content': content, 'flags': flags, 'location': location, 'on_navigate': on_navigate, 'on_hide': on_hide})
        self.popup_visible = True

    def update_popup(self, content):
        if self.popups:
            self.popups[-1]['content'] = content

    def hide_popup(self):
        self.popup_visible = False

    def is_popup_visible(self):
        return self.popup_visible

    def phantoms(self, key=''):
        ps = self._phantom_sets.get(key)
        return list(ps.phantoms) if ps else []

    # status / commands
    def set_status(self, key, value):
        self._status[key] = value

    def erase_status(self, key):
        self._status.pop(key, None)

    def get_status(self, key):
        return self._status.get(key, '')

    def run_command(self, name, args=None):
        args = args or {}
        if name == 'save':
            if self._file:
                with open(self._file, 'w', encoding='utf-8') as fh:
                    fh.write(self._text)
                self._dirty = False
                sublime_plugin.dispatch_event('on_post_save', self)
            return
        if name == 'append':
            self._mutate(len(self._text), len(self._text), args.get('characters', ''))
            return
        if name == 'insert':
            pt = self._sel[0].end() if self._sel else len(self._text)
            self._mutate(pt, pt, args.get('characters', ''))
            return
        if name == 'select_all':
            self._sel.clear()
            self._sel.add(Region(0, len(self._text)))
            return
        cls = sublime_plugin.find_text_command(name)
        if cls is not None:
            cls(self).run(Edit(self), **args)
            return
        if self._window is not None:
            self._window.run_command(name, args)

    # color scheme
    def style(self):
        return dict(self.style_overrides)

    def style_for_scope(self, scope):
        color = SCOPE_COLORS.get(scope, self.style_overrides.get('foreground'))
        return {'foreground': color, 'background': None, 'bold': False, 'italic': False}

    def close(self):
        if self._window is not None:
            self._window._remove_view(self)  # pylint: disable=protected-access
        self._valid = False
        sublime_plugin.dispatch_event('on_close', self)
        return True


class Window:
    def __init__(self, folders=None):
        self._id = next(_window_ids)
        self._folders = list(folders or [])
        self._groups = [[]]
        self._active_group = 0
        self._active = None
        self._layout = {'cols': [0.0, 1.0], 'rows': [0.0, 1.0], 'cells': [[0, 0, 1, 1]]}
        self.quick_panels = []
        self.input_panels = []
        self.commands = []
        _windows.append(self)

    def id(self):
        return self._id

    def folders(self):
        return list(self._folders)

    def set_folders(self, folders):
        self._folders = list(folders)

    # groups / layout
    def num_groups(self):
        return len(self._groups)

    def get_layout(self):
        return dict(self._layout)

    def set_layout(self, layout):
        self._layout = dict(layout)
        n = len(layout.get('cells', [[0, 0, 1, 1]]))
        while len(self._groups) < n:
            self._groups.append([])
        while len(self._groups) > n:
            extra = self._groups.pop()
            self._groups[-1].extend(extra)
        self._active_group = min(self._active_group, n - 1)

    def active_group(self):
        return self._active_group

    def focus_group(self, group):
        self._active_group = group
        views = self._groups[group]
        if views:
            self._active = views[0]

    def views_in_group(self, group):
        return list(self._groups[group]) if 0 <= group < len(self._groups) else []

    def get_view_index(self, view):
        for g, views in enumerate(self._groups):
            if view in views:
                return g, views.index(view)
        return -1, -1

    def set_view_index(self, view, group, index):
        for views in self._groups:
            if view in views:
                views.remove(view)
        self._groups[group].insert(min(index, len(self._groups[group])), view)

    def views(self):
        return [v for views in self._groups for v in views]

    def active_view(self):
        return self._active

    def active_view_in_group(self, group):
        views = self._groups[group]
        return self._active if self._active in views else (views[0] if views else None)

    def focus_view(self, view):
        self._active = view
        g, _ = self.get_view_index(view)
        if g >= 0:
            self._active_group = g
        sublime_plugin.dispatch_event('on_activated', view)

    def new_file(self, flags=0, syntax=''):  # pylint: disable=unused-argument
        view = View(self)
        self._groups[self._active_group].append(view)
        self.focus_view(view)
        return view

    def open_file(self, fname, flags=0, group=-1):  # pylint: disable=unused-argument
        fname = os.path.abspath(fname)
        existing = self.find_open_file(fname)
        if existing is not None:
            self.focus_view(existing)
            return existing
        text = ''
        if os.path.isfile(fname):
            with open(fname, 'r', encoding='utf-8', errors='replace') as fh:
                text = fh.read().replace('\r\n', '\n')
        view = View(self, fname, text)
        self._groups[self._active_group].append(view)
        self.focus_view(view)
        sublime_plugin.dispatch_event('on_load', view)
        return view

    def find_open_file(self, fname):
        fname = os.path.normcase(os.path.abspath(fname))
        for v in self.views():
            if v.file_name() and os.path.normcase(v.file_name()) == fname:
                return v
        return None

    def _remove_view(self, view):
        for views in self._groups:
            if view in views:
                views.remove(view)
        if self._active is view:
            remaining = self.views()
            self._active = remaining[0] if remaining else None

    def run_command(self, name, args=None):
        args = args or {}
        self.commands.append((name, args))
        cls = sublime_plugin.find_window_command(name)
        if cls is not None:
            cls(self).run(**args)
            return
        if self._active is not None and sublime_plugin.find_text_command(name) is not None:
            self._active.run_command(name, args)
            return
        cls = sublime_plugin.find_application_command(name)
        if cls is not None:
            cls().run(**args)

    def show_quick_panel(self, items, on_select, flags=0, selected_index=-1, on_highlight=None, placeholder=None):  # pylint: disable=unused-argument,too-many-arguments
        self.quick_panels.append({'items': items, 'on_select': on_select, 'selected_index': selected_index, 'placeholder': placeholder})

    def show_input_panel(self, caption, initial_text, on_done, on_change, on_cancel):  # pylint: disable=unused-argument
        self.input_panels.append({'caption': caption, 'initial': initial_text, 'on_done': on_done})

    def status_message(self, msg):
        status_message(msg)

    def project_data(self):
        return {'folders': [{'path': f} for f in self._folders]}


_windows = []


def windows():
    return list(_windows)


def active_window():
    return _windows[0] if _windows else None


def run_command(name, args=None):
    cls = sublime_plugin.find_application_command(name)
    if cls is not None:
        cls().run(**(args or {}))


def reset():
    """Test helper: forget windows, settings and messages."""
    del _windows[:]
    del messages[:]
    _settings.clear()
    with _timer_lock:
        del _timers[:]
