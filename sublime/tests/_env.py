"""Test bootstrap: make the fake ``sublime`` modules and the iMark package
importable and create a fake Packages directory that contains the iMark
package (with a tiny web/ tree) so resource lookups work."""
import os
import shutil
import sys
import tempfile

TESTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(TESTS))
STUBS = os.path.join(TESTS, 'stubs')

FAKE_HOME = tempfile.mkdtemp(prefix='imark-fake-sublime-')
FAKE_PACKAGES = os.path.join(FAKE_HOME, 'Packages')
os.environ['IMARK_FAKE_SUBLIME_HOME'] = FAKE_HOME
os.environ['IMARK_FAKE_PACKAGES'] = FAKE_PACKAGES

for p in (STUBS, os.path.join(REPO, 'sublime')):
    if p not in sys.path:
        sys.path.insert(0, p)

PKG = os.path.join(FAKE_PACKAGES, 'iMark')
WEB = os.path.join(PKG, 'web')
os.makedirs(os.path.join(WEB, 'themes', 'Monokai Syntax'), exist_ok=True)
os.makedirs(os.path.join(WEB, 'css'), exist_ok=True)
os.makedirs(os.path.join(WEB, 'webview'), exist_ok=True)
os.makedirs(os.path.join(WEB, 'sublime'), exist_ok=True)
os.makedirs(os.path.join(WEB, 'icons'), exist_ok=True)
with open(os.path.join(WEB, 'themes', 'Monokai Syntax', 'theme.css'), 'w', encoding='utf-8') as fh:
    fh.write('body { --background-primary: #272822; }\n')
with open(os.path.join(WEB, 'themes', 'Monokai Syntax', 'manifest.json'), 'w', encoding='utf-8') as fh:
    fh.write('{"name": "Monokai Syntax", "author": "lat3ncy", "version": "1.0.0"}\n')
with open(os.path.join(WEB, 'css', 'vscode-bridge.css'), 'w', encoding='utf-8') as fh:
    fh.write('body.imark-vscode-bridge { color: red; }\n')
with open(os.path.join(WEB, 'webview', 'main.js'), 'w', encoding='utf-8') as fh:
    fh.write('console.log("main");\n')
with open(os.path.join(WEB, 'sublime', 'bridge.js'), 'w', encoding='utf-8') as fh:
    fh.write('console.log("bridge");\n')
with open(os.path.join(WEB, 'icons', 'imark.png'), 'wb') as fh:
    fh.write(b'\x89PNG\r\n\x1a\n')
with open(os.path.join(PKG, 'imark-package.json'), 'w', encoding='utf-8') as fh:
    fh.write('{"name": "iMark", "version": "0.0.0-test"}\n')
shutil.copy(os.path.join(REPO, 'sublime', 'iMark', 'iMark.sublime-settings'), os.path.join(PKG, 'iMark.sublime-settings'))

import sublime  # noqa: E402  pylint: disable=wrong-import-position,unused-import
import sublime_plugin  # noqa: E402,F401  pylint: disable=wrong-import-position,unused-import


def make_vault(base=None):
    """Create a small vault: notes, an image and an .obsidian folder with a theme."""
    base = base or tempfile.mkdtemp(prefix='imark-vault-')
    os.makedirs(os.path.join(base, 'Notes', 'sub'), exist_ok=True)
    os.makedirs(os.path.join(base, 'attachments'), exist_ok=True)
    os.makedirs(os.path.join(base, '.obsidian', 'themes', 'Minimal'), exist_ok=True)
    os.makedirs(os.path.join(base, '.obsidian', 'snippets'), exist_ok=True)
    files = {
        'Notes/Alpha.md': '# Alpha\n\nHello [[Beta]] and ![[pic.png]]\n',
        'Notes/sub/Beta.md': '# Beta\n\nBody\n',
        'Other/Beta.md': '# Other Beta\n',
        'attachments/pic.png': '\x89PNG',
        '.obsidian/themes/Minimal/theme.css': 'body{--x:1}',
        '.obsidian/themes/Minimal/manifest.json': '{"name":"Minimal","author":"kepano","version":"7.0.0"}',
        '.obsidian/snippets/wide.css': '.x{}',
        '.obsidian/appearance.json': '{"cssTheme":"Minimal","theme":"moonstone","accentColor":"#7c3aed","enabledCssSnippets":["wide"]}',
    }
    for rel, content in files.items():
        p = os.path.join(base, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(content)
    return base
