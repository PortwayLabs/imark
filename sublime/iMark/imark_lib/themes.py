"""iMark's theme library for Sublime Text (port of themeManager.ts /
themeImport.ts): Obsidian themes and CSS snippets imported into
Packages/User/iMark, selected through iMark.sublime-settings."""
import json
import os
import re
import shutil
import threading
import time

from . import util

DEFAULT_THEME = 'Monokai Syntax'
_HEX = re.compile(r'^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


# ---- pure helpers -------------------------------------------------------------------------

def read_manifest(directory):
    try:
        with open(os.path.join(directory, 'manifest.json'), 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def theme_source(directory):
    """``{'dir', 'id', 'name', 'author', 'version'}`` for a folder containing theme.css."""
    if not os.path.isfile(os.path.join(directory, 'theme.css')):
        return None
    manifest = read_manifest(directory)
    theme_id = os.path.basename(directory)
    return {
        'dir': directory,
        'id': theme_id,
        'name': str(manifest.get('name') or theme_id),
        'author': manifest.get('author'),
        'version': manifest.get('version'),
    }


def themes_in(directory):
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return []
    out = []
    for name in names:
        full = os.path.join(directory, name)
        if os.path.isdir(full):
            t = theme_source(full)
            if t:
                out.append(t)
    out.sort(key=lambda t: t['name'].lower())
    return out


def read_appearance(obsidian_dir):
    try:
        with open(os.path.join(obsidian_dir, 'appearance.json'), 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def find_vault_dir(start):
    directory = start
    for _ in range(16):
        if os.path.exists(os.path.join(directory, '.obsidian')):
            return directory
        parent = os.path.dirname(directory)
        if parent == directory:
            break
        directory = parent
    return None


def plan_import(picked):
    """Work out what a picked path contains (theme folder / theme.css, folder of
    themes, .obsidian folder or vault root, loose .css snippet)."""
    plan = {'themes': [], 'snippets': [], 'appearance': None, 'vault_snippets_dir': None}
    if not os.path.exists(picked):
        return plan
    if os.path.isfile(picked):
        if os.path.basename(picked).lower() == 'theme.css':
            t = theme_source(os.path.dirname(picked))
            if t:
                plan['themes'].append(t)
        elif picked.lower().endswith('.css'):
            plan['snippets'].append(picked)
        return plan
    single = theme_source(picked)
    if single:
        plan['themes'].append(single)
        return plan
    obsidian_dir = None
    if os.path.basename(picked) == '.obsidian':
        obsidian_dir = picked
    elif os.path.exists(os.path.join(picked, '.obsidian')):
        obsidian_dir = os.path.join(picked, '.obsidian')
    elif os.path.basename(picked) == 'themes' and os.path.basename(os.path.dirname(picked)) == '.obsidian':
        obsidian_dir = os.path.dirname(picked)
    themes_dir = os.path.join(obsidian_dir, 'themes') if obsidian_dir else picked
    plan['themes'] = themes_in(themes_dir)
    if obsidian_dir:
        plan['appearance'] = read_appearance(obsidian_dir)
        snippets_dir = os.path.join(obsidian_dir, 'snippets')
        if os.path.isdir(snippets_dir):
            plan['vault_snippets_dir'] = snippets_dir
        for name in (plan['appearance'] or {}).get('enabledCssSnippets') or []:
            p = os.path.join(snippets_dir, '%s.css' % name)
            if os.path.isfile(p):
                plan['snippets'].append(p)
    return plan


def sanitize_id(theme_id):
    return re.sub(r'[\\/:*?"<>|]', '_', theme_id).strip() or 'theme'


def copy_theme(source, library_dir):
    """Copy a theme folder (theme.css, manifest.json, assets) into the library."""
    target = os.path.join(library_dir, sanitize_id(source['id']))
    if os.path.isdir(target):
        shutil.rmtree(target)
    os.makedirs(library_dir, exist_ok=True)

    def ignore(_dir, names):
        return [n for n in names if n.startswith('.') or n == 'node_modules']

    shutil.copytree(source['dir'], target, ignore=ignore)
    if not os.path.isfile(os.path.join(target, 'manifest.json')):
        with open(os.path.join(target, 'manifest.json'), 'w', encoding='utf-8') as fh:
            json.dump({'name': source['name'], 'author': source.get('author') or '', 'version': source.get('version') or '0.0.0'}, fh, indent=2)
    return target


def copy_snippet(file_path, snippets_dir):
    os.makedirs(snippets_dir, exist_ok=True)
    target = os.path.join(snippets_dir, os.path.basename(file_path))
    shutil.copyfile(file_path, target)
    return target


def appearance_mode(theme):
    return {'obsidian': 'dark', 'moonstone': 'light', 'system': 'auto'}.get(theme)


def hex_to_hsl(value):
    m = _HEX.match((value or '').strip())
    if not m:
        return None
    v = m.group(1)
    if len(v) == 3:
        v = ''.join(c * 2 for c in v)
    r, g, b = (int(v[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    h = s = 0.0
    if mx != mn:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = ((g - b) / d + (6 if g < b else 0)) * 60
        elif mx == g:
            h = ((b - r) / d + 2) * 60
        else:
            h = ((r - g) / d + 4) * 60
    return int(round(h)), int(round(s * 100)), int(round(l * 100))


# ---- library ----------------------------------------------------------------------------------

class ThemeLibrary:
    def __init__(self, bundled_dir, library_dir, snippets_dir):
        self.bundled_dir = bundled_dir
        self.library_dir = library_dir
        self.snippets_dir = snippets_dir
        for d in (library_dir, snippets_dir):
            try:
                os.makedirs(d, exist_ok=True)
            except OSError:
                util.log_exception('mkdir %s' % d)

    # ---- discovery ------------------------------------------------------------------------

    def external_dir(self):
        configured = str(util.setting('theme.path', '') or '').strip()
        if not configured:
            return None
        p = util.expand_user_path(configured)
        return p if os.path.isdir(p) else None

    def list_themes(self):
        def entries(directory, origin):
            out = []
            for t in themes_in(directory):
                e = dict(t)
                e['css_path'] = os.path.join(t['dir'], 'theme.css')
                e['origin'] = origin
                out.append(e)
            return out

        lib = entries(self.library_dir, 'library')
        bundled = entries(self.bundled_dir, 'bundled')
        ext_dir = self.external_dir()
        external = entries(ext_dir, 'external') if ext_dir else []
        out = list(lib)
        ids = {t['id'] for t in lib}
        for t in bundled + external:
            if t['id'] in ids:
                continue
            ids.add(t['id'])
            out.append(t)
        return out

    def find_theme(self, id_or_name):
        themes = self.list_themes()
        for t in themes:
            if t['id'] == id_or_name:
                return t
        for t in themes:
            if t['name'] == id_or_name:
                return t
        return None

    def list_snippets(self):
        try:
            return sorted(f for f in os.listdir(self.snippets_dir) if f.lower().endswith('.css'))
        except OSError:
            return []

    def suggested_import_dir(self, file_path, folders):
        starts = ([os.path.dirname(file_path)] if file_path else []) + list(folders or [])
        for s in starts:
            vault = find_vault_dir(s)
            if vault:
                themes = os.path.join(vault, '.obsidian', 'themes')
                return themes if os.path.isdir(themes) else vault
        return None

    # ---- import / remove ---------------------------------------------------------------------

    def import_from(self, paths):
        result = {'themes': [], 'snippets': [], 'plan': {'themes': [], 'snippets': [], 'appearance': None, 'vault_snippets_dir': None}}
        for p in paths:
            plan = plan_import(p)
            result['plan']['themes'].extend(plan['themes'])
            result['plan']['snippets'].extend(plan['snippets'])
            if plan['appearance'] and not result['plan']['appearance']:
                result['plan']['appearance'] = plan['appearance']
                result['plan']['vault_snippets_dir'] = plan['vault_snippets_dir']
            for t in plan['themes']:
                target = copy_theme(t, self.library_dir)
                entry = theme_source(target)
                if entry:
                    entry['css_path'] = os.path.join(target, 'theme.css')
                    entry['origin'] = 'library'
                    result['themes'].append(entry)
            for s in plan['snippets']:
                result['snippets'].append(copy_snippet(s, self.snippets_dir))
        return result

    def remove_theme(self, theme_id):
        target = os.path.join(self.library_dir, theme_id)
        if not os.path.isdir(target):
            return False
        shutil.rmtree(target)
        return True

    def apply_appearance(self, plan, result):
        """Apply a vault's appearance settings (theme, mode, accent, snippets)."""
        applied = []
        a = plan.get('appearance') or {}
        css_theme = a.get('cssTheme')
        if css_theme:
            t = next((x for x in result['themes'] if x['name'] == css_theme or x['id'] == css_theme), None) or self.find_theme(css_theme)
            if t:
                util.set_setting('theme.name', t['id'])
                applied.append('theme "%s"' % t['name'])
        mode = appearance_mode(a.get('theme'))
        if mode:
            util.set_setting('theme.mode', mode)
            applied.append('mode %s' % mode)
        accent = a.get('accentColor')
        if accent and _HEX.match(str(accent)):
            util.set_setting('theme.accent_color', accent if str(accent).startswith('#') else '#%s' % accent)
            applied.append('accent %s' % accent)
        if result['snippets']:
            names = [os.path.basename(s) for s in result['snippets']]
            util.set_setting('theme.snippets', names)
            applied.append('%d snippet(s)' % len(names))
        return applied

    def set_theme(self, value):
        util.set_setting('theme.name', value)

    # ---- resolution ----------------------------------------------------------------------------

    def current_name(self):
        requested = str(util.setting('theme.name', DEFAULT_THEME) or '').strip()
        if requested in ('', 'auto'):
            requested = DEFAULT_THEME
        return requested

    def resolve(self):
        requested = self.current_name()
        mode = str(util.setting('theme.mode', 'auto') or 'auto')
        if mode not in ('auto', 'light', 'dark'):
            mode = 'auto'
        accent = str(util.setting('theme.accent_color', '') or '').strip()
        kind, name, missing = 'vscode', 'Follow Sublime Text', None
        css_paths = []
        if requested == 'obsidian':
            kind, name = 'obsidian', 'Obsidian'
        elif requested not in ('sublime', 'vscode'):
            t = self.find_theme(requested)
            if t:
                kind, name = 'theme', t['name']
                css_paths.append(t['css_path'])
            else:
                missing = requested
                fallback = self.find_theme(DEFAULT_THEME)
                if fallback:
                    kind, name = 'theme', '%s (theme "%s" not found)' % (fallback['name'], requested)
                    css_paths.append(fallback['css_path'])
                else:
                    kind, name = 'obsidian', 'Obsidian (theme "%s" not found)' % requested
        for s in util.setting('theme.snippets', []) or []:
            if not s:
                continue
            p = util.expand_user_path(str(s))
            if not os.path.isabs(p):
                file_name = p if p.endswith('.css') else '%s.css' % p
                candidates = [os.path.join(self.snippets_dir, file_name)]
                ext_dir = self.external_dir()
                if ext_dir:
                    candidates.append(os.path.join(ext_dir, file_name))
                    candidates.append(os.path.join(os.path.dirname(ext_dir), 'snippets', file_name))
                p = next((c for c in candidates if os.path.isfile(c)), '')
            if p and os.path.isfile(p):
                css_paths.append(p)
        return {'name': name, 'kind': kind, 'css_paths': css_paths, 'mode': mode, 'accent_color': accent, 'missing': missing}

    def to_theme_info(self, server, resolved=None):
        """Protocol ``ThemeInfo`` with URLs served by ``server``."""
        resolved = resolved or self.resolve()
        css_uris = []
        if resolved['kind'] == 'vscode':
            css_uris.append(server.web_url('css/vscode-bridge.css'))
            css_uris.append('%s/scheme.css?v=%d' % (server.base_url(), int(time.time() * 1000)))
        for p in resolved['css_paths']:
            css_uris.append(server.url_for_file(p))
        extra = ''
        hsl = hex_to_hsl(resolved['accent_color']) if resolved['accent_color'] else None
        if hsl:
            extra += 'body{--accent-h:%d;--accent-s:%d%%;--accent-l:%d%%;}' % hsl
        return {'name': resolved['name'], 'kind': resolved['kind'], 'cssUris': css_uris, 'mode': resolved['mode'], 'extraCss': extra}


class ThemeWatcher:
    """Polls theme CSS files for changes (no fs watcher in the stdlib) and calls
    ``on_change`` on the main thread. Cheap: a few stat() calls every 2 seconds."""

    def __init__(self, on_change, interval=2.0):
        self.on_change = on_change
        self.interval = interval
        self._paths = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None

    def set_paths(self, paths):
        with self._lock:
            self._paths = {p: self._stamp(p) for p in paths}
        if paths and self._thread is None:
            self._thread = threading.Thread(target=self._run, name='imark-theme-watch', daemon=True)
            self._thread.start()

    @staticmethod
    def _stamp(path):
        try:
            st = os.stat(path)
            return (st.st_mtime, st.st_size)
        except OSError:
            return None

    def _run(self):
        while not self._stop.wait(self.interval):
            changed = False
            with self._lock:
                for p, old in list(self._paths.items()):
                    new = self._stamp(p)
                    if new != old:
                        self._paths[p] = new
                        changed = True
            if changed:
                util.main_thread(self.on_change)

    def stop(self):
        self._stop.set()
