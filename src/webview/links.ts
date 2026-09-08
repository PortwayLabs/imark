// Resolves Obsidian-style link targets against the workspace file index that
// the extension host sends us, and builds webview-loadable URLs.
import type { DocumentInfo, FileEntry, ResourceRoot } from '../shared/protocol';
import { FileLookup, MD_EXT, basename, dirname, normalizePath, parseTarget, stripMd } from '../shared/linkResolve';

export { parseTarget, MD_EXT };
export const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i;
export const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|3gp|flac)$/i;
export const VIDEO_EXT = /\.(mp4|webm|ogv|mov|mkv)$/i;
export const PDF_EXT = /\.pdf$/i;

export interface Resolved {
  entry: FileEntry;
  /** Webview URL for the file. */
  url: string;
  /** Path relative to its root (POSIX). */
  path: string;
}

export function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

export class LinkResolver {
  private lookup: FileLookup;
  files: FileEntry[] = [];

  constructor(
    public roots: ResourceRoot[],
    public doc: DocumentInfo,
    files: FileEntry[],
  ) {
    this.files = files;
    this.lookup = new FileLookup(files);
  }

  setFiles(files: FileEntry[]): void {
    this.files = files;
    this.lookup = new FileLookup(files);
  }

  urlFor(entry: FileEntry): string {
    const root = this.roots[entry.root];
    return `${root.webviewUri.replace(/\/$/, '')}/${encodePath(entry.path)}`;
  }

  /** Resolve a wikilink target like Obsidian does (alias/heading are ignored). */
  resolve(target: string): Resolved | null {
    const t = parseTarget(target).path;
    const hit = this.lookup.resolve(t, this.doc.root, this.doc.path);
    return hit ? { entry: hit, url: this.urlFor(hit), path: hit.path } : null;
  }

  /** Build a URL for a standard Markdown link/image target relative to the document. */
  urlForMarkdownPath(href: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return href;
    let clean = href.split('#')[0];
    try {
      clean = decodeURI(clean);
    } catch {
      /* keep as is */
    }
    const root = this.roots[this.doc.root];
    if (clean.startsWith('/')) {
      for (const r of this.roots) {
        if (clean.toLowerCase().startsWith(r.fsPath.toLowerCase() + '/')) {
          return `${r.webviewUri.replace(/\/$/, '')}/${encodePath(clean.slice(r.fsPath.length + 1))}`;
        }
      }
      return `${root.webviewUri.replace(/\/$/, '')}/${encodePath(clean.replace(/^\/+/, ''))}`;
    }
    const docDir = dirname(this.doc.path);
    const rel = normalizePath(docDir ? `${docDir}/${clean}` : clean);
    return `${root.webviewUri.replace(/\/$/, '')}/${encodePath(rel)}`;
  }

  /** Candidate names for `[[` completion (shortest unique path, like Obsidian). */
  completionItems(): { label: string; detail: string; path: string; isNote: boolean }[] {
    const seen = new Map<string, number>();
    for (const f of this.files) {
      const key = stripMd(basename(f.path)).toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return this.files.map((f) => {
      const isNote = MD_EXT.test(f.path);
      const name = isNote ? stripMd(basename(f.path)) : basename(f.path);
      const unique = (seen.get(stripMd(name).toLowerCase()) ?? 0) <= 1;
      const label = unique ? name : isNote ? stripMd(f.path) : f.path;
      return { label, detail: f.path, path: f.path, isNote };
    });
  }
}
