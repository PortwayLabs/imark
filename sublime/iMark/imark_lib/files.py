"""Workspace file index used for wikilink resolution, embeds and completion
(port of src/extension/fileIndex.ts). Roots are the window's folders plus the
document's own folder when the document lives outside them."""
import os
import threading
import time

import sublime

from . import util
from .links import MD_EXT, FileLookup, parse_target

INDEXED_EXTS = frozenset(
    '.md .markdown .mdown .mkd .png .jpg .jpeg .gif .svg .webp .bmp .avif .ico .pdf .mp3 .wav .m4a .ogg .flac .mp4 .webm .mov .mkv'.split()
)
SKIP_DIRS = frozenset({'node_modules', '.git', '.obsidian', '.trash'})
MAX_FILES = 50000
CACHE_TTL = 15.0


def _case_key(path):
    return path if util.platform() == 'linux' else path.lower()


def is_inside(path, root):
    return _case_key(path).startswith(_case_key(os.path.normpath(root)) + os.sep)


def scan_dir(root, limit=MAX_FILES):
    """Relative POSIX paths of indexable files below ``root`` (sorted)."""
    out = []
    root = os.path.normpath(root)
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in SKIP_DIRS)
        for name in files:
            if os.path.splitext(name)[1].lower() in INDEXED_EXTS:
                rel = os.path.relpath(os.path.join(current, name), root)
                out.append(util.to_posix(rel))
                if len(out) >= limit:
                    out.sort()
                    return out
    out.sort()
    return out


class FileIndex:
    def __init__(self):
        self._cache = {}
        self._lock = threading.Lock()

    def invalidate(self, path=None):
        with self._lock:
            if path is None:
                self._cache.clear()
                return
            for root in list(self._cache):
                if is_inside(path, root) or os.path.normpath(root) == os.path.normpath(path):
                    del self._cache[root]

    def contains(self, path):
        """True when ``path`` is already part of a cached index."""
        directory = os.path.dirname(path)
        with self._lock:
            for root, (_, entries) in self._cache.items():
                if is_inside(path, root) or os.path.normpath(root) == directory:
                    rel = util.to_posix(os.path.relpath(path, root))
                    return rel in entries
        return False

    def _entries_for_root(self, root):
        root = os.path.normpath(root)
        now = time.time()
        with self._lock:
            cached = self._cache.get(root)
            if cached and now - cached[0] < CACHE_TTL:
                return cached[1]
        entries = scan_dir(root)
        with self._lock:
            self._cache[root] = (time.time(), entries)
        return entries

    # ---- per document --------------------------------------------------------------------------

    def roots_for_path(self, file_path, folders):
        roots = [os.path.normpath(f) for f in folders if f]
        if file_path and not any(is_inside(file_path, r) for r in roots):
            roots.append(os.path.dirname(os.path.normpath(file_path)))
        return roots

    def roots_for(self, view):
        window = view.window() if view is not None else None
        folders = list(window.folders()) if window is not None else []
        return self.roots_for_path(view.file_name() if view is not None else None, folders)

    def files_for_roots(self, roots):
        """``[{'root': i, 'path': rel}]`` for every root (scans, cached)."""
        out = []
        for idx, root in enumerate(roots):
            for rel in self._entries_for_root(root):
                out.append({'root': idx, 'path': rel})
        return out

    def doc_info_for(self, file_path, roots):
        for idx, root in enumerate(roots):
            if is_inside(file_path, root):
                return idx, util.to_posix(os.path.relpath(file_path, root))
        idx = len(roots) - 1
        return idx, util.to_posix(os.path.relpath(file_path, roots[idx])) if roots else (0, os.path.basename(file_path))

    def resolve_in(self, file_path, roots, target):
        """Resolve a wikilink target to an absolute path (or None)."""
        files = self.files_for_roots(roots)
        root_idx, doc_path = self.doc_info_for(file_path, roots)
        hit = FileLookup(files).resolve(parse_target(target).path, root_idx, doc_path)
        if hit is None:
            return None
        return os.path.join(roots[hit['root']], *hit['path'].split('/'))

    def new_note_path(self, file_path, roots, target):
        """Where a note for an unresolved wikilink is created (document folder, or
        root-relative when the target contains a folder)."""
        p = parse_target(target).path
        name = p if MD_EXT.search(p) else p + '.md'
        if '/' in name:
            root_idx, _ = self.doc_info_for(file_path, roots)
            return os.path.join(roots[root_idx], *name.split('/'))
        return os.path.join(os.path.dirname(file_path), name)


def open_views_text(path):
    """Unsaved buffer contents when ``path`` is open in any window, else None."""
    for window in sublime.windows():
        view = window.find_open_file(path)
        if view is not None and not view.is_loading():
            return util.view_text(view)
    return None
