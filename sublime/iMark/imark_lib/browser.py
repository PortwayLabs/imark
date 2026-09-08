"""Open the editor URL in a browser: the system default, a Chromium-family
'app' window (no tabs / address bar, feels like a standalone editor) or a
user-supplied command."""
import os
import shutil
import subprocess
import sys

from . import util

MAC_APPS = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium', 'Vivaldi', 'Arc', 'Opera']
LINUX_BINARIES = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'chromium', 'chromium-browser', 'vivaldi']


def windows_binaries():
    roots = [os.environ.get('PROGRAMFILES', r'C:\Program Files'), os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'), os.environ.get('LOCALAPPDATA', '')]
    rel = [
        r'Google\Chrome\Application\chrome.exe',
        r'Microsoft\Edge\Application\msedge.exe',
        r'BraveSoftware\Brave-Browser\Application\brave.exe',
        r'Chromium\Application\chrome.exe',
        r'Vivaldi\Application\vivaldi.exe',
    ]
    out = []
    for root in roots:
        if not root:
            continue
        for r in rel:
            out.append(os.path.join(root, r))
    return out


def open_app_window(url):
    """Try to open ``url`` in a Chromium-family app window. Returns True on success."""
    try:
        if sys.platform == 'darwin':
            for app in MAC_APPS:
                if os.path.isdir('/Applications/%s.app' % app) or os.path.isdir(os.path.expanduser('~/Applications/%s.app' % app)):
                    subprocess.Popen(['open', '-na', app, '--args', '--app=%s' % url])
                    return True
        elif os.name == 'nt':
            for exe in windows_binaries():
                if os.path.isfile(exe):
                    subprocess.Popen([exe, '--app=%s' % url])
                    return True
        else:
            for name in LINUX_BINARIES:
                exe = shutil.which(name)
                if exe:
                    subprocess.Popen([exe, '--app=%s' % url])
                    return True
    except Exception:  # pylint: disable=broad-except
        util.log_exception('open_app_window')
    return False


def open_url(url):
    """Open ``url`` according to the ``browser`` setting."""
    mode = util.setting('browser', 'default')
    if isinstance(mode, str) and mode.strip() and mode not in ('default', 'app'):
        mode = [mode]
    if isinstance(mode, list) and mode:
        cmd = [str(a).replace('{url}', url) for a in mode]
        if not any('{url}' in str(a) for a in mode):
            cmd.append(url)
        try:
            subprocess.Popen(cmd)
            return
        except Exception:  # pylint: disable=broad-except
            util.log_exception('browser command %r' % (cmd,))
    if mode == 'app' and open_app_window(url):
        return
    util.open_external(url)
