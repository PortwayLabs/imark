#!/usr/bin/env python3
"""Run the iMark Sublime Text package without Sublime Text.

Uses the fake ``sublime`` API from sublime/tests/stubs and the editor bundle
from dist/ (run ``npm run build`` first). Handy for developing / debugging the
server and the browser bridge:

    python3 sublime/dev/standalone.py dev/sample.md --open
    python3 sublime/dev/standalone.py ~/vault/Note.md --folder ~/vault --port 8790

Buffer changes coming from the browser are kept in memory; Cmd/Ctrl+S in the
browser writes the file. ``--edit-after S TEXT`` appends TEXT to the buffer
after S seconds to exercise the Sublime → browser direction.
"""
import argparse
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
STUBS = os.path.join(REPO, 'sublime', 'tests', 'stubs')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('file', help='Markdown file to open')
    parser.add_argument('--folder', action='append', default=[], help='workspace folder (repeatable)')
    parser.add_argument('--port', type=int, default=0, help='server port (default: free port)')
    parser.add_argument('--open', action='store_true', help='open the editor in the default browser')
    parser.add_argument('--theme', default=None, help='theme.name setting (e.g. "sublime", "obsidian", "Monokai Syntax")')
    parser.add_argument('--edit-after', nargs=2, metavar=('SECONDS', 'TEXT'), help='append TEXT to the buffer after SECONDS')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()

    dist = os.path.join(REPO, 'dist', 'sublime')
    if not os.path.isfile(os.path.join(REPO, 'dist', 'webview', 'main.js')):
        sys.exit('dist/webview/main.js missing: run "npm run build" first')
    # Fake Packages dir: Packages/iMark → the source package, with web/ pointing at dist/media.
    home = os.path.join(REPO, 'dist', 'standalone-home')
    packages = os.path.join(home, 'Packages')
    os.makedirs(os.path.join(packages, 'User'), exist_ok=True)
    pkg_link = os.path.join(packages, 'iMark')
    src_pkg = os.path.join(REPO, 'sublime', 'iMark')
    if os.path.islink(pkg_link) or os.path.exists(pkg_link):
        if os.path.islink(pkg_link):
            os.unlink(pkg_link)
    os.symlink(src_pkg, pkg_link)
    web = os.path.join(src_pkg, 'web')
    if not os.path.isdir(web):
        os.makedirs(web, exist_ok=True)
        for src, dest in [('dist/webview', 'webview'), ('dist/sublime/bridge.js', 'sublime/bridge.js'), ('media/css', 'css'), ('media/themes', 'themes'), ('media/icons/imark.png', 'icons/imark.png')]:
            target = os.path.join(web, dest)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if not os.path.lexists(target):
                os.symlink(os.path.join(REPO, src), target)
    if not os.path.isfile(os.path.join(src_pkg, 'imark-package.json')):
        with open(os.path.join(src_pkg, 'imark-package.json'), 'w', encoding='utf-8') as fh:
            fh.write('{"name": "iMark", "version": "dev"}\n')
    os.environ['IMARK_FAKE_SUBLIME_HOME'] = home
    os.environ['IMARK_FAKE_PACKAGES'] = packages
    sys.path.insert(0, STUBS)
    sys.path.insert(0, os.path.join(REPO, 'sublime'))

    import sublime  # pylint: disable=import-error,import-outside-toplevel
    import iMark.imark as plugin  # pylint: disable=import-error,import-outside-toplevel

    settings = sublime.load_settings('iMark.sublime-settings')
    settings.set('server.port', args.port)
    settings.set('debug', args.debug)
    if args.theme:
        settings.set('theme.name', args.theme)
    plugin.plugin_loaded()

    file_path = os.path.abspath(args.file)
    folders = [os.path.abspath(f) for f in args.folder] or [os.path.dirname(file_path)]
    window = sublime.Window(folders=folders)
    view = window.open_file(file_path)
    url = plugin.manager.open(view, open_browser=False)
    print('iMark standalone: %s' % url)
    print('  file:    %s' % file_path)
    print('  folders: %s' % ', '.join(folders))
    print('  landing: %s' % plugin.manager.server.base_url())
    sys.stdout.flush()
    if args.open:
        import webbrowser  # pylint: disable=import-outside-toplevel
        webbrowser.open(url)

    if args.edit_after:
        delay, text = float(args.edit_after[0]), args.edit_after[1]

        def later():
            time.sleep(delay)
            sublime.set_timeout(lambda: view.set_text(view.substr(sublime.Region(0, view.size())) + text), 0)
            print('appended %r to the buffer' % text)

        threading.Thread(target=later, daemon=True).start()

    try:
        sublime.run_forever()
    except KeyboardInterrupt:
        plugin.plugin_unloaded()


if __name__ == '__main__':
    main()
