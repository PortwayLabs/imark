// Obsidian-style link target parsing and resolution, shared by the extension
// host (opening/creating notes) and the webview (rendering links & embeds).
import type { FileEntry } from './protocol';

export const MD_EXT = /\.(md|markdown|mdown|mkd)$/i;

export interface ParsedTarget {
  /** Path or name without `#heading`, `^block` or `|alias`. */
  path: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
  /** Size hint from `|300` or `|300x200`. */
  width: number | null;
  height: number | null;
}

export function parseTarget(raw: string): ParsedTarget {
  let text = raw.trim();
  let alias: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const pipe = text.indexOf('|');
  if (pipe >= 0) {
    alias = text.slice(pipe + 1).trim();
    text = text.slice(0, pipe).trim();
    const m = /^(\d+)(?:x(\d+))?$/.exec(alias);
    if (m) {
      width = parseInt(m[1], 10);
      height = m[2] ? parseInt(m[2], 10) : null;
      alias = null;
    }
  }
  let heading: string | null = null;
  let block: string | null = null;
  const hash = text.indexOf('#');
  if (hash >= 0) {
    const frag = text.slice(hash + 1);
    text = text.slice(0, hash);
    if (frag.startsWith('^')) block = frag.slice(1);
    else heading = frag;
  }
  return { path: text.replace(/\\/g, '/'), heading, block, alias, width, height };
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function stripMd(p: string): string {
  return p.replace(MD_EXT, '');
}

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Index over the file list for fast lookups. */
export class FileLookup {
  private byName = new Map<string, FileEntry[]>();
  private byPath = new Map<string, FileEntry>();

  constructor(public files: readonly FileEntry[]) {
    for (const f of files) {
      this.byPath.set(`${f.root}:${f.path.toLowerCase()}`, f);
      const name = basename(f.path).toLowerCase();
      const key = MD_EXT.test(name) ? stripMd(name) : name;
      const list = this.byName.get(key);
      if (list) list.push(f);
      else this.byName.set(key, [f]);
    }
  }

  /**
   * Resolve `target` (already stripped of alias/heading) relative to a document.
   * Tries a path relative to the document folder, then relative to the root,
   * then the shortest basename match — mirroring Obsidian's link resolution.
   */
  resolve(target: string, docRoot: number, docPath: string): FileEntry | null {
    const lower = target.replace(/\\/g, '/').trim().toLowerCase();
    if (!lower) return null;
    const candidates: string[] = [];
    const docDir = dirname(docPath);
    if (docDir) candidates.push(normalizePath(`${docDir}/${lower}`));
    candidates.push(normalizePath(lower));
    for (const c of candidates) {
      const hit =
        this.byPath.get(`${docRoot}:${c}`) ?? (MD_EXT.test(c) ? undefined : this.byPath.get(`${docRoot}:${c}.md`));
      if (hit) return hit;
    }
    const name = basename(lower);
    const key = MD_EXT.test(name) ? stripMd(name) : name;
    const list = this.byName.get(key);
    if (list && list.length) {
      const dir = dirname(lower);
      const filtered = dir ? list.filter((f) => f.path.toLowerCase().endsWith(`${dir}/${basename(f.path).toLowerCase()}`)) : list;
      const pool = filtered.length ? filtered : list;
      const sameRoot = pool.filter((f) => f.root === docRoot);
      const pick = (sameRoot.length ? sameRoot : pool).slice().sort((a, b) => a.path.length - b.path.length)[0];
      return pick;
    }
    return null;
  }
}
