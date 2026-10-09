"""Obsidian-style link target parsing and resolution (port of
src/shared/linkResolve.ts so the Sublime host resolves links exactly like the
editor does)."""
import re

MD_EXT = re.compile(r'\.(md|markdown|mdown|mkd)$', re.IGNORECASE)
_SIZE = re.compile(r'^(\d+)(?:x(\d+))?$')


class ParsedTarget:
    __slots__ = ('path', 'heading', 'block', 'alias', 'width', 'height')

    def __init__(self, path, heading=None, block=None, alias=None, width=None, height=None):
        self.path = path
        self.heading = heading
        self.block = block
        self.alias = alias
        self.width = width
        self.height = height

    def __repr__(self):
        return 'ParsedTarget(%r, heading=%r, block=%r, alias=%r)' % (self.path, self.heading, self.block, self.alias)


def parse_target(raw):
    text = raw.strip()
    alias = width = height = None
    pipe = text.find('|')
    if pipe >= 0:
        alias = text[pipe + 1:].strip()
        text = text[:pipe].strip()
        m = _SIZE.match(alias)
        if m:
            width = int(m.group(1))
            height = int(m.group(2)) if m.group(2) else None
            alias = None
    heading = block = None
    hash_pos = text.find('#')
    if hash_pos >= 0:
        frag = text[hash_pos + 1:]
        text = text[:hash_pos]
        if frag.startswith('^'):
            block = frag[1:]
        else:
            heading = frag
    return ParsedTarget(text.replace('\\', '/'), heading, block, alias, width, height)


def basename(p):
    i = p.rfind('/')
    return p if i < 0 else p[i + 1:]


def dirname(p):
    i = p.rfind('/')
    return '' if i < 0 else p[:i]


def strip_md(p):
    return MD_EXT.sub('', p)


def normalize_path(p):
    parts = []
    for seg in p.split('/'):
        if seg in ('', '.'):
            continue
        if seg == '..':
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    return '/'.join(parts)


class FileLookup:
    """Index over ``[{'root': int, 'path': str}]`` entries for fast resolution."""

    def __init__(self, files):
        self.files = list(files)
        self.by_path = {}
        self.by_name = {}
        for f in self.files:
            self.by_path['%d:%s' % (f['root'], f['path'].lower())] = f
            name = basename(f['path']).lower()
            key = strip_md(name) if MD_EXT.search(name) else name
            self.by_name.setdefault(key, []).append(f)

    def resolve(self, target, doc_root, doc_path):
        """Resolve ``target`` (alias/heading already stripped) like Obsidian: relative
        to the document folder, then to the root, then the shortest basename match."""
        lower = target.replace('\\', '/').strip().lower()
        if not lower:
            return None
        candidates = []
        doc_dir = dirname(doc_path)
        if doc_dir:
            candidates.append(normalize_path('%s/%s' % (doc_dir, lower)))
        candidates.append(normalize_path(lower))
        for c in candidates:
            hit = self.by_path.get('%d:%s' % (doc_root, c))
            if hit is None and not MD_EXT.search(c):
                hit = self.by_path.get('%d:%s.md' % (doc_root, c))
            if hit is not None:
                return hit
        name = basename(lower)
        key = strip_md(name) if MD_EXT.search(name) else name
        pool = self.by_name.get(key)
        if not pool:
            return None
        folder = dirname(lower)
        if folder:
            filtered = [f for f in pool if f['path'].lower().endswith('%s/%s' % (folder, basename(f['path']).lower()))]
            if filtered:
                pool = filtered
        same_root = [f for f in pool if f['root'] == doc_root]
        chosen = same_root or pool
        return sorted(chosen, key=lambda f: len(f['path']))[0]
