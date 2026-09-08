"""iMark for Sublime Text: Typora / Obsidian style live-preview Markdown editing.

Sublime Text cannot host a web view, so the plugin runs a small local server
(standard library only) that serves iMark's editor bundle to your browser and
keeps the browser editor and the Sublime Text buffer in sync over a WebSocket.
"""
import os
import sys

import sublime
import sublime_plugin

# Sublime Text only reloads this top-level module when it changes; drop the cached
# implementation modules so a reload picks up their changes too (development).
for _name in [n for n in list(sys.modules) if n.startswith(__package__ + '.imark_lib')]:
    del sys.modules[_name]

from .imark_lib import util  # noqa: E402  pylint: disable=wrong-import-position
from .imark_lib.preview import PreviewManager, is_preview_view  # noqa: E402  pylint: disable=wrong-import-position
from .imark_lib.sync import SyncManager  # noqa: E402  pylint: disable=wrong-import-position
from .imark_lib.themes import DEFAULT_THEME  # noqa: E402  pylint: disable=wrong-import-position

manager = None  # pylint: disable=invalid-name
preview = None  # pylint: disable=invalid-name


def _on_settings_changed():
    util.init_cache()
    if manager is not None:
        manager.on_settings_changed()
    if preview is not None:
        preview.on_settings_changed()


def plugin_loaded():
    global manager, preview  # pylint: disable=global-statement
    util.init_cache()
    try:
        manager = SyncManager()
        preview = PreviewManager(manager)
    except Exception:  # pylint: disable=broad-except
        util.log_exception('plugin_loaded')
        raise
    util.settings().clear_on_change('imark')
    util.settings().add_on_change('imark', _on_settings_changed)
    util.log('loaded v%s (Sublime Text %s)', util.package_version(), sublime.version(), force=True)


def plugin_unloaded():
    global manager, preview  # pylint: disable=global-statement
    try:
        util.settings().clear_on_change('imark')
    except Exception:  # pylint: disable=broad-except
        pass
    if preview is not None:
        preview.shutdown()
        preview = None
    if manager is not None:
        manager.shutdown()
        manager = None


def _ready():
    return manager is not None


def _markdown_paths(files=None, paths=None):
    out = []
    for p in list(files or []) + list(paths or []):
        if p and os.path.isfile(p) and util.is_markdown_path(p) and p not in out:
            out.append(p)
    return out


def _when_loaded(view, fn):
    if view is None or not view.is_valid():
        return
    if view.is_loading():
        sublime.set_timeout(lambda: _when_loaded(view, fn), 30)
        return
    fn(view)


class _ViewTarget:
    """Resolve the view a command applies to (tab context menus pass group/index)."""

    def target_view(self, group=None, index=None):
        window = self.window  # pylint: disable=no-member
        if group is not None and index is not None and group >= 0 and index >= 0:
            views = window.views_in_group(group)
            if 0 <= index < len(views):
                return views[index]
        return window.active_view()


# ---- editor ------------------------------------------------------------------------------------


class ImarkOpenCommand(_ViewTarget, sublime_plugin.WindowCommand):
    """Open the current (or selected) Markdown file in the iMark editor."""

    def run(self, files=None, paths=None, group=None, index=None):
        if not _ready():
            return
        targets = _markdown_paths(files, paths)
        if targets:
            for p in targets:
                _when_loaded(self.window.open_file(p), manager.open)
            return
        view = self.target_view(group, index)
        if not util.is_markdown_view(view):
            sublime.status_message('iMark: the active file is not a Markdown file')
            return
        if not view.file_name():
            sublime.status_message('iMark: save the file first')
            return
        manager.open(view)

    def is_enabled(self, files=None, paths=None, group=None, index=None):
        if files or paths:
            return bool(_markdown_paths(files, paths))
        view = self.target_view(group, index)
        return util.is_markdown_view(view) and bool(view.file_name())

    def is_visible(self, files=None, paths=None, group=None, index=None):
        return self.is_enabled(files, paths, group, index)


class ImarkCopyEditorUrlCommand(_ViewTarget, sublime_plugin.WindowCommand):
    """Copy the editor URL for the active file (to open it in another browser)."""

    def run(self, group=None, index=None):
        view = self.target_view(group, index)
        url = manager.open(view, open_browser=False) if _ready() else None
        if url:
            sublime.set_clipboard(url)
            sublime.status_message('iMark: editor URL copied')

    def is_enabled(self, group=None, index=None):
        view = self.target_view(group, index)
        return util.is_markdown_view(view) and bool(view.file_name())


class _PostToEditor(sublime_plugin.WindowCommand):
    message = None

    def run(self):
        if not _ready():
            return
        view = self.window.active_view()
        if not manager.post_to_view(view, dict(self.message)):
            if util.is_markdown_view(view) and view.file_name():
                manager.open(view)
            else:
                sublime.status_message('iMark: no connected iMark editor for this file')

    def is_enabled(self):
        view = self.window.active_view()
        return util.is_markdown_view(view) and bool(view.file_name())


class ImarkToggleReadingViewCommand(_PostToEditor):
    message = {'type': 'toggleReading'}


class ImarkToggleSourceModeCommand(_PostToEditor):
    message = {'type': 'toggleSource'}


class ImarkFocusEditorCommand(_PostToEditor):
    message = {'type': 'focus'}


class ImarkToggleReadableLineWidthCommand(sublime_plugin.ApplicationCommand):
    def run(self):
        current = bool(util.setting('editor.readable_line_width', True))
        util.set_setting('editor.readable_line_width', not current)
        sublime.status_message('iMark: readable line width %s' % ('off' if current else 'on'))


class ImarkStopServerCommand(sublime_plugin.ApplicationCommand):
    def run(self):
        if _ready():
            manager.stop_server()
            sublime.status_message('iMark: server stopped')

    def is_enabled(self):
        return _ready() and manager.server is not None and manager.server.running


class ImarkApplyChangesCommand(sublime_plugin.TextCommand):
    """Internal: apply editor changes (Python indexes, sorted) inside one edit."""

    def run(self, edit, changes):
        for c in sorted(changes, key=lambda c: c['from'], reverse=True):
            self.view.replace(edit, sublime.Region(int(c['from']), int(c['to'])), c['insert'])

    def is_visible(self):
        return False


# ---- in-Sublime preview -------------------------------------------------------------------------


class ImarkToggleReadingSheetCommand(_ViewTarget, sublime_plugin.WindowCommand):
    """Show / hide the read-only reading sheet (minihtml) beside the Markdown file."""

    def run(self, group=None, index=None):
        if preview is None:
            return
        view = self.target_view(group, index)
        if is_preview_view(view):
            preview.toggle_sheet(view)
            return
        if not util.is_markdown_view(view):
            sublime.status_message('iMark: open a Markdown file to show the reading sheet')
            return
        shown = preview.toggle_sheet(view)
        sublime.status_message('iMark: reading sheet %s' % ('shown' if shown else 'hidden'))

    def is_enabled(self, group=None, index=None):
        view = self.target_view(group, index)
        return preview is not None and (util.is_markdown_view(view) or is_preview_view(view) or preview.has_sheet(self.window))

    def description(self, group=None, index=None):
        return 'Hide Reading Sheet' if preview is not None and preview.has_sheet(self.window) else 'Show Reading Sheet'


class ImarkToggleInlineImagesCommand(sublime_plugin.ApplicationCommand):
    def run(self):
        current = bool(util.setting('preview.inline_images', True))
        util.set_setting('preview.inline_images', not current)
        sublime.status_message('iMark: inline images %s' % ('off' if current else 'on'))

    def description(self):
        return 'Hide Inline Images' if util.setting('preview.inline_images', True) else 'Show Inline Images'



class ImarkDebugDumpCommand(sublime_plugin.WindowCommand):
    """Internal support tool: write plugin state (and the console text, when
    accessible) to Cache/iMark/debug-dump.txt."""

    def run(self):
        lines = ['iMark %s, Sublime Text %s' % (util.package_version(), sublime.version())]
        if manager is not None:
            lines.append('server: %s' % (manager.server.base_url() if manager.server and manager.server.running else 'stopped'))
            lines.append('sessions: %s' % ', '.join('%s(%s, sockets=%d)' % (s.sid, os.path.basename(s.file or ''), len(s.sockets)) for s in manager.sessions.values()))
        if preview is not None:
            for wid, sheet in preview.sheets.items():
                lines.append('sheet window %d: alive=%s preview=%s group=%d source=%s large=%s html=%d chars' % (
                    wid, sheet.alive(), sheet.preview.id() if sheet.preview else None, sheet.group, sheet.source_id, sheet.large, len(sheet.last_html or '')))
            lines.append('inline phantom sets: %s' % ', '.join('view %d: %d' % (vid, len(ps.phantoms) if hasattr(ps, 'phantoms') else -1) for vid, ps in preview._inline_sets.items()))  # pylint: disable=protected-access
        lines.append('layout: %s' % self.window.get_layout())
        for group in range(self.window.num_groups()):
            lines.append('group %d: %s' % (group, ', '.join('%d:%s' % (v.id(), v.name() or os.path.basename(v.file_name() or '?')) for v in self.window.views_in_group(group))))
        console = self.window.find_output_panel('console')
        if console is not None:
            text = console.substr(sublime.Region(0, console.size()))
            lines.append('--- console (last 60 lines) ---')
            lines.extend(text.split('\n')[-60:])
        else:
            lines.append('console panel not accessible via API')
        try:
            os.makedirs(util.cache_dir(), exist_ok=True)
            with open(os.path.join(util.cache_dir(), 'debug-dump.txt'), 'w', encoding='utf-8') as fh:
                fh.write('\n'.join(lines) + '\n')
            sublime.status_message('iMark: debug dump written to %s' % os.path.join(util.cache_dir(), 'debug-dump.txt'))
        except OSError:
            util.log_exception('debug dump')

    def is_visible(self):
        return False

# ---- themes ------------------------------------------------------------------------------------


def _theme_kind(letter, name):
    return (sublime.KIND_ID_COLOR_PURPLISH, letter, name)


class ImarkSelectThemeCommand(sublime_plugin.WindowCommand):
    def run(self):
        if not _ready():
            return
        themes = manager.themes
        current = themes.current_name()
        items = []
        actions = []

        def add(trigger, details, annotation, kind, action):
            items.append(sublime.QuickPanelItem(trigger, details, annotation, kind))
            actions.append(action)

        def describe(t):
            parts = ['by %s' % t['author'] if t.get('author') else '', str(t.get('version') or ''), {'bundled': 'built-in', 'external': 'external folder'}.get(t['origin'], '')]
            return ' · '.join(p for p in parts if p)

        listed = themes.list_themes()
        for t in [x for x in listed if x['origin'] == 'bundled']:
            add(t['name'], describe(t), 'current' if t['id'] == current else 'built-in', _theme_kind('T', 'Theme'), ('theme', t['id']))
        add('Follow Sublime Text', 'adapt Obsidian variables to the Sublime Text color scheme', 'current' if current in ('sublime', 'vscode') else '', _theme_kind('S', 'Sublime'), ('theme', 'sublime'))
        add('Obsidian default', "Obsidian's default look", 'current' if current == 'obsidian' else '', _theme_kind('O', 'Obsidian'), ('theme', 'obsidian'))
        for t in [x for x in listed if x['origin'] != 'bundled']:
            add(t['name'], describe(t), 'current' if t['id'] == current else t['origin'], _theme_kind('T', 'Theme'), ('theme', t['id']))
        add('Import theme…', 'pick a theme folder, a themes folder, an Obsidian vault or a .css snippet', '', _theme_kind('+', 'Import'), ('import', None))
        add('Remove an imported theme…', 'delete a theme from the iMark library', '', _theme_kind('-', 'Remove'), ('remove', None))
        add('Open iMark themes folder', themes.library_dir, '', _theme_kind('F', 'Folder'), ('folder', None))

        def on_done(i):
            if i < 0:
                return
            kind, value = actions[i]
            if kind == 'theme':
                themes.set_theme(value)
                sublime.status_message('iMark: theme set to %s' % items[i].trigger)
            elif kind == 'import':
                self.window.run_command('imark_import_theme')
            elif kind == 'remove':
                self.window.run_command('imark_remove_theme')
            elif kind == 'folder':
                util.reveal_in_os(themes.library_dir)

        selected = next((i for i, a in enumerate(actions) if a[0] == 'theme' and (a[1] == current or (a[1] == 'sublime' and current == 'vscode'))), -1)
        self.window.show_quick_panel(items, on_done, selected_index=selected, placeholder='iMark: select a theme (stored in iMark.sublime-settings)')


class ImarkImportThemeCommand(sublime_plugin.WindowCommand):
    def run(self, paths=None, files=None, dirs=None):
        if not _ready():
            return
        picked = [p for p in list(paths or []) + list(files or []) + list(dirs or []) if p]
        if picked:
            self.import_paths(picked)
            return
        view = self.window.active_view()
        suggested = manager.themes.suggested_import_dir(view.file_name() if view else None, self.window.folders())
        options = [
            sublime.QuickPanelItem('Choose a folder…', 'a theme folder (theme.css), a themes folder, an Obsidian vault or its .obsidian folder', '', _theme_kind('D', 'Folder')),
            sublime.QuickPanelItem('Choose CSS files…', 'theme.css files and / or CSS snippets', '', _theme_kind('C', 'CSS')),
            sublime.QuickPanelItem('Type a path…', 'enter the path of a theme folder, vault or CSS file', '', _theme_kind('P', 'Path')),
        ]

        def on_done(i):
            if i == 0:
                sublime.select_folder_dialog(lambda p: p and self.import_paths([p] if isinstance(p, str) else list(p)), directory=suggested)
            elif i == 1:
                sublime.open_dialog(lambda p: p and self.import_paths([p] if isinstance(p, str) else list(p)), [('CSS', ['css'])], directory=suggested, multi_select=True)
            elif i == 2:
                self.window.show_input_panel('iMark: path to import', suggested or '', lambda p: p.strip() and self.import_paths([util.expand_user_path(p.strip())]), None, None)

        self.window.show_quick_panel(options, on_done, placeholder='iMark: import an Obsidian theme or CSS snippet')

    def is_visible(self, paths=None, files=None, dirs=None):
        picked = list(paths or []) + list(files or []) + list(dirs or [])
        if not picked:
            return True
        return any(os.path.isdir(p) or p.lower().endswith('.css') for p in picked)

    def import_paths(self, paths):
        themes = manager.themes
        try:
            result = themes.import_from(paths)
        except Exception as exc:  # pylint: disable=broad-except
            util.log_exception('import themes')
            sublime.error_message('iMark: import failed: %s' % exc)
            return
        if not result['themes'] and not result['snippets']:
            sublime.error_message('iMark: nothing to import. Pick a theme folder (containing theme.css), a themes folder, an Obsidian vault / .obsidian folder, or a .css snippet.')
            return
        n_t, n_s = len(result['themes']), len(result['snippets'])
        summary = ' and '.join(
            s for s in [
                '%d theme%s (%s)' % (n_t, 's' if n_t > 1 else '', ', '.join(t['name'] for t in result['themes'])) if n_t else '',
                '%d snippet%s' % (n_s, 's' if n_s > 1 else '') if n_s else '',
            ] if s
        )
        plan = result['plan']
        appearance = plan.get('appearance')
        if appearance:
            details = ', '.join(
                d for d in [
                    'theme "%s"' % appearance['cssTheme'] if appearance.get('cssTheme') else '',
                    'base %s' % appearance['theme'] if appearance.get('theme') else '',
                    'accent %s' % appearance['accentColor'] if appearance.get('accentColor') else '',
                    '%d snippet(s)' % len(appearance['enabledCssSnippets']) if appearance.get('enabledCssSnippets') else '',
                ] if d
            )
            choice = sublime.yes_no_cancel_dialog(
                'iMark imported %s.\n\nThis vault\'s appearance settings (%s) can be applied to iMark as well.' % (summary, details),
                'Apply appearance settings',
                'Just import',
            )
            if choice == sublime.DIALOG_YES:
                applied = themes.apply_appearance(plan, result)
                sublime.status_message('iMark: applied %s' % (', '.join(applied) or 'nothing'))
        elif n_t == 1 and not n_s:
            if sublime.ok_cancel_dialog('iMark imported %s.' % summary, 'Use this theme'):
                themes.set_theme(result['themes'][0]['id'])
        elif n_s and not n_t:
            names = [os.path.basename(s) for s in result['snippets']]
            current = list(util.setting('theme.snippets', []) or [])
            util.set_setting('theme.snippets', current + [n for n in names if n not in current])
            sublime.status_message('iMark imported and enabled %s' % summary)
        else:
            sublime.status_message('iMark imported %s' % summary)
        manager.broadcast_theme()


class ImarkRemoveThemeCommand(sublime_plugin.WindowCommand):
    def run(self):
        if not _ready():
            return
        themes = manager.themes
        library = [t for t in themes.list_themes() if t['origin'] == 'library']
        if not library:
            sublime.status_message('iMark: no imported themes')
            return
        items = [sublime.QuickPanelItem(t['name'], t['dir'], 'by %s' % t['author'] if t.get('author') else '', _theme_kind('T', 'Theme')) for t in library]

        def on_done(i):
            if i < 0:
                return
            t = library[i]
            if not sublime.ok_cancel_dialog('Remove theme "%s" from iMark?' % t['name'], 'Remove'):
                return
            themes.remove_theme(t['id'])
            if themes.current_name() == t['id']:
                themes.set_theme(DEFAULT_THEME)
            manager.broadcast_theme()
            sublime.status_message('iMark: removed %s' % t['name'])

        self.window.show_quick_panel(items, on_done, placeholder='iMark: remove a theme from the library')


class ImarkOpenThemesFolderCommand(sublime_plugin.ApplicationCommand):
    def run(self):
        if _ready():
            util.reveal_in_os(manager.themes.library_dir)


class ImarkReloadThemeCommand(sublime_plugin.ApplicationCommand):
    def run(self):
        if _ready():
            manager.broadcast_theme()
            sublime.status_message('iMark: theme reloaded')


# ---- events --------------------------------------------------------------------------------------


class ImarkEventListener(sublime_plugin.EventListener):
    def on_modified(self, view):
        if manager is not None:
            manager.on_view_modified(view)
        if preview is not None:
            preview.on_modified(view)

    def on_close(self, view):
        if manager is not None:
            manager.on_view_closed(view)
        if preview is not None:
            preview.on_close(view)

    def on_post_save(self, view):
        if manager is not None and manager.sessions:
            manager.on_view_saved(view)
        if preview is not None:
            preview.on_post_save(view)

    def on_activated(self, view):
        if manager is not None:
            manager.on_view_activated(view)
        if preview is not None:
            preview.on_activated(view)

    def on_load(self, view):
        if preview is not None:
            preview.on_load(view)

    def on_hover(self, view, point, hover_zone):
        if preview is not None:
            preview.on_hover(view, point, hover_zone)
