// Workspace file index used for wikilink resolution, embeds and completion.
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileEntry } from '../shared/protocol';
import { FileLookup, MD_EXT, parseTarget } from '../shared/linkResolve';

const INDEXED_EXT = 'md,markdown,mdown,mkd,png,jpg,jpeg,gif,svg,webp,bmp,avif,ico,pdf,mp3,wav,m4a,ogg,flac,mp4,webm,mov,mkv';
const EXT_RE = new RegExp(`\\.(${INDEXED_EXT.split(',').join('|')})$`, 'i');

export interface RootInfo {
  uri: vscode.Uri;
}

export class FileIndex implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposables: vscode.Disposable[] = [];
  private workspaceFiles: FileEntry[] = [];
  private extraRoots = new Map<string, FileEntry[]>();
  private ready: Promise<void>;
  private debounce: NodeJS.Timeout | undefined;

  constructor() {
    this.ready = this.scanWorkspace();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((u) => this.onFsEvent(u)),
      watcher.onDidDelete((u) => this.onFsEvent(u)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.ready = this.scanWorkspace();
      }),
    );
  }

  private onFsEvent(uri: vscode.Uri) {
    if (!EXT_RE.test(uri.fsPath) && !/\.$/.test(uri.fsPath)) {
      // could be a directory; rescan lazily
      if (path.extname(uri.fsPath)) return;
    }
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.ready = this.scanWorkspace();
    }, 400);
  }

  roots(): vscode.Uri[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
  }

  /** Roots for a document: workspace folders, plus the document's own folder if outside. */
  rootsFor(docUri: vscode.Uri): vscode.Uri[] {
    const roots = this.roots();
    const containing = roots.findIndex((r) => docUri.fsPath.toLowerCase().startsWith(r.fsPath.toLowerCase() + path.sep));
    if (containing >= 0) return roots;
    return [...roots, vscode.Uri.file(path.dirname(docUri.fsPath))];
  }

  private async scanWorkspace(): Promise<void> {
    const roots = this.roots();
    if (!roots.length) {
      this.workspaceFiles = [];
      this.emitter.fire();
      return;
    }
    try {
      const uris = await vscode.workspace.findFiles(`**/*.{${INDEXED_EXT}}`, '{**/node_modules/**,**/.git/**,**/.obsidian/**,**/.trash/**}', 50000);
      const entries: FileEntry[] = [];
      for (const u of uris) {
        const idx = roots.findIndex((r) => u.fsPath.toLowerCase().startsWith(r.fsPath.toLowerCase() + path.sep));
        if (idx < 0) continue;
        entries.push({ root: idx, path: path.relative(roots[idx].fsPath, u.fsPath).split(path.sep).join('/') });
      }
      entries.sort((a, b) => a.root - b.root || a.path.localeCompare(b.path));
      this.workspaceFiles = entries;
    } catch {
      this.workspaceFiles = [];
    }
    this.emitter.fire();
  }

  private async scanDir(dir: string, rootIndex: number): Promise<FileEntry[]> {
    const cached = this.extraRoots.get(dir);
    if (cached) return cached.map((e) => ({ ...e, root: rootIndex }));
    const out: FileEntry[] = [];
    const walk = async (d: string, depth: number) => {
      if (depth > 4 || out.length > 5000) return;
      let ents: import('node:fs').Dirent[] = [];
      try {
        ents = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (EXT_RE.test(e.name)) out.push({ root: 0, path: path.relative(dir, full).split(path.sep).join('/') });
      }
    };
    await walk(dir, 0);
    this.extraRoots.set(dir, out);
    setTimeout(() => this.extraRoots.delete(dir), 30000);
    return out.map((e) => ({ ...e, root: rootIndex }));
  }

  /** Files visible from a document, with root indexes matching `rootsFor(docUri)`. */
  async filesFor(docUri: vscode.Uri): Promise<FileEntry[]> {
    await this.ready;
    const roots = this.rootsFor(docUri);
    const workspaceRootCount = this.roots().length;
    if (roots.length === workspaceRootCount) return this.workspaceFiles;
    const extra = await this.scanDir(roots[roots.length - 1].fsPath, roots.length - 1);
    return [...this.workspaceFiles, ...extra];
  }

  /** Document info relative to its root. */
  docInfo(docUri: vscode.Uri): { root: number; path: string } {
    const roots = this.rootsFor(docUri);
    const idx = roots.findIndex((r) => docUri.fsPath.toLowerCase().startsWith(r.fsPath.toLowerCase() + path.sep));
    const root = idx >= 0 ? idx : roots.length - 1;
    return { root, path: path.relative(roots[root].fsPath, docUri.fsPath).split(path.sep).join('/') };
  }

  /** Resolve a wikilink target to a file URI. */
  async resolve(docUri: vscode.Uri, target: string): Promise<vscode.Uri | null> {
    const files = await this.filesFor(docUri);
    const roots = this.rootsFor(docUri);
    const info = this.docInfo(docUri);
    const hit = new FileLookup(files).resolve(parseTarget(target).path, info.root, info.path);
    if (!hit) return null;
    return vscode.Uri.joinPath(roots[hit.root], ...hit.path.split('/'));
  }

  /** Where a new note for an unresolved link should be created (same folder as the document). */
  newNoteUri(docUri: vscode.Uri, target: string): vscode.Uri {
    const p = parseTarget(target).path;
    const name = MD_EXT.test(p) ? p : `${p}.md`;
    if (name.includes('/')) {
      const roots = this.rootsFor(docUri);
      const info = this.docInfo(docUri);
      return vscode.Uri.joinPath(roots[info.root], ...name.split('/'));
    }
    return vscode.Uri.file(path.join(path.dirname(docUri.fsPath), name));
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
