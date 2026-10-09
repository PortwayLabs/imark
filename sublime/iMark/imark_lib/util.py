"""Small helpers shared by the iMark Sublime Text package."""
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import webbrowser

import sublime

PACKAGE_NAME = 'iMark'
SETTINGS_FILE = 'iMark.sublime-settings'
MD_EXTS = ('.md', '.markdown', '.mdown', '.mkd')

_log_lock = threading.Lock()

# Values background threads need. They are snapshotted on the main thread by
# ``init_cache`` so that server / worker threads never call the Sublime API:
# an API call from a background thread waits for the plugin host's main thread,
# and if that thread is itself waiting on a lock held by the caller the plugin
# host deadlocks (and Sublime Text's UI with it).
_cache = {'debug': False, 'platform': None, 'packages_path': None, 'cache_dir': None, 'version': None}


def init_cache():
    """(main thread) Snapshot settings / paths used from background threads."""
    _cache['debug'] = bool(setting('debug', False))
    _cache['platform'] = {'osx': 'mac', 'windows': 'win'}.get(sublime.platform(), 'linux')
    _cache['packages_path'] = sublime.packages_path()
    _cache['cache_dir'] = os.path.join(sublime.cache_path(), PACKAGE_NAME)
    _cache['version'] = str(package_metadata().get('version') or 'dev')


# ---- settings (main thread only) -------------------------------------------------------------

def settings():
    return sublime.load_settings(SETTINGS_FILE)


def setting(key, default=None):
    value = settings().get(key)
    return default if value is None else value


def set_setting(key, value):
    s = settings()
    s.set(key, value)
    sublime.save_settings(SETTINGS_FILE)


def debug_enabled():
    return _cache['debug']


# ---- logging (safe from any thread) -----------------------------------------------------------

def log(message, *args, force=False):
    """Print to the Sublime console (and to Cache/iMark/imark.log when debug is on)."""
    if not force and not _cache['debug']:
        return
    text = message % args if args else message
    line = '[iMark] %s' % text
    log_dir = _cache['cache_dir']
    with _log_lock:
        print(line, flush=True)
        if _cache['debug'] and log_dir:
            try:
                os.makedirs(log_dir, exist_ok=True)
                with open(os.path.join(log_dir, 'imark.log'), 'a', encoding='utf-8') as fh:
                    fh.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), line))
            except OSError:
                pass


def log_exception(context):
    log('%s\n%s', context, traceback.format_exc(), force=True)


# ---- threads ---------------------------------------------------------------------------------

def main_thread(fn, *args, **kwargs):
    """Run ``fn`` on Sublime's main thread as soon as possible."""
    sublime.set_timeout(lambda: fn(*args, **kwargs), 0)


def call_on_main(fn, *args, timeout=8.0, **kwargs):
    """Run ``fn`` on the main thread and wait for its result (from a worker thread)."""
    done = threading.Event()
    box = {}

    def runner():
        try:
            box['value'] = fn(*args, **kwargs)
        except Exception as exc:  # pylint: disable=broad-except
            box['error'] = exc
            log_exception('call_on_main(%s)' % getattr(fn, '__name__', fn))
        finally:
            done.set()

    sublime.set_timeout(runner, 0)
    if not done.wait(timeout):
        raise TimeoutError('main thread did not answer within %ss' % timeout)
    if 'error' in box:
        raise box['error']
    return box.get('value')


class Debouncer:
    """Coalesce bursts of calls into one main-thread call after ``delay_ms``."""

    def __init__(self, fn, delay_ms):
        self.fn = fn
        self.delay_ms = delay_ms
        self._serial = 0

    def __call__(self, *args):
        self._serial += 1
        serial = self._serial

        def fire():
            if serial == self._serial:
                self.fn(*args)

        sublime.set_timeout(fire, self.delay_ms)


# ---- platform / paths -------------------------------------------------------------------------

def platform():
    if _cache['platform'] is None:
        _cache['platform'] = {'osx': 'mac', 'windows': 'win'}.get(sublime.platform(), 'linux')
    return _cache['platform']


def _packages_path():
    if _cache['packages_path'] is None:
        _cache['packages_path'] = sublime.packages_path()
    return _cache['packages_path']


def package_dir():
    return os.path.join(_packages_path(), PACKAGE_NAME)


def user_dir():
    """Persistent per-user data: Packages/User/iMark (themes, snippets)."""
    return os.path.join(_packages_path(), 'User', PACKAGE_NAME)


def cache_dir():
    if _cache['cache_dir'] is None:
        _cache['cache_dir'] = os.path.join(sublime.cache_path(), PACKAGE_NAME)
    return _cache['cache_dir']


def to_posix(path):
    return path.replace(os.sep, '/') if os.sep != '/' else path


def expand_user_path(path):
    if not path:
        return path
    return os.path.expandvars(os.path.expanduser(path))


def is_markdown_path(path):
    return bool(path) and path.lower().endswith(MD_EXTS)


def is_markdown_view(view):
    if view is None or not view.is_valid():
        return False
    if is_markdown_path(view.file_name() or ''):
        return True
    try:
        return view.match_selector(0, 'text.html.markdown')
    except Exception:  # pylint: disable=broad-except
        return False


def view_text(view):
    return view.substr(sublime.Region(0, view.size()))


def package_metadata():
    """Contents of imark-package.json (written by the build script)."""
    try:
        return json.loads(sublime.load_resource('Packages/%s/imark-package.json' % PACKAGE_NAME))
    except Exception:  # pylint: disable=broad-except
        return {}


def package_version():
    if _cache['version'] is None:
        _cache['version'] = str(package_metadata().get('version') or 'dev')
    return _cache['version']


def web_root():
    """Directory holding the editor bundle (web/). Extracted to the cache when the
    package is installed as a zipped .sublime-package."""
    unpacked = os.path.join(package_dir(), 'web')
    if os.path.isdir(unpacked):
        return unpacked
    target = os.path.join(cache_dir(), 'web-%s' % package_version())
    marker = os.path.join(target, '.complete')
    if os.path.exists(marker):
        return target
    prefix = 'Packages/%s/web/' % PACKAGE_NAME
    count = 0
    for res in sublime.find_resources('*'):
        if not res.startswith(prefix):
            continue
        rel = res[len(prefix):]
        dest = os.path.join(target, *rel.split('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as fh:
            fh.write(sublime.load_binary_resource(res))
        count += 1
    if count:
        with open(marker, 'w', encoding='utf-8') as fh:
            fh.write(str(count))
        log('extracted %d web assets to %s', count, target, force=True)
    return target


# ---- OS integration ---------------------------------------------------------------------------

def reveal_in_os(path):
    """Open a folder (or reveal a file) in Finder / Explorer / the file manager."""
    try:
        if sys.platform == 'darwin':
            subprocess.Popen(['open', path])
        elif os.name == 'nt':
            os.startfile(path)  # pylint: disable=no-member
        else:
            subprocess.Popen(['xdg-open', path])
    except Exception:  # pylint: disable=broad-except
        log_exception('reveal_in_os(%s)' % path)


def open_external(url):
    """Open a URL (or file:// URL) with the system default handler."""
    try:
        window = sublime.active_window()
        if window is not None:
            window.run_command('open_url', {'url': url})
            return
    except Exception:  # pylint: disable=broad-except
        pass
    try:
        webbrowser.open(url)
    except Exception:  # pylint: disable=broad-except
        log_exception('open_external(%s)' % url)


def activate_sublime():
    """Bring the Sublime Text window to the front (best effort, macOS only)."""
    if sys.platform != 'darwin':
        return
    try:
        exe = sublime.executable_path()
        bundle = exe.split('/Contents/')[0] if '/Contents/' in exe else None
        subprocess.Popen(['open', bundle] if bundle else ['open', '-a', 'Sublime Text'])
    except Exception:  # pylint: disable=broad-except
        log_exception('activate_sublime')


def file_url(path):
    from urllib.request import pathname2url  # local import: rarely used
    url = pathname2url(os.path.abspath(path))
    if not url.startswith('///'):
        url = '//' + url if url.startswith('/') else '///' + url
    return 'file:' + url
