// Discovers Obsidian themes / snippets and resolves which stylesheets a
// webview should load.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ThemeInfo, ThemeMode } from '../shared/protocol';

export interface ThemeEntry {
  /** Display name (from manifest.json when available). */
  name: string;
  /** Folder name, used as the setting value. */
  id: string;
  dir: string;
  cssPath: string;
  author?: string;
}

export interface ResolvedTheme {
  name: string;
  kind: 'vscode' | 'obsidian' | 'theme';
  cssPaths: string[];
  mode: ThemeMode;
  accentColor: string;
}

const exists = (p: string) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

export function findVaultDir(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    if (exists(path.join(dir, '.obsidian'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (exists(path.join(f.uri.fsPath, '.obsidian'))) return f.uri.fsPath;
  }
  return null;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export class ThemeManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private watchers = new Map<string, fs.FSWatcher>();
  private debounce: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('imark.theme')) this.fire();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.fire()),
    );
  }

  private fire() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.emitter.fire(), 120);
  }

  private config() {
    return vscode.workspace.getConfiguration('imark.theme');
  }

  /** Directory holding Obsidian themes for a document, if any. */
  themesDir(docUri: vscode.Uri): string | null {
    const configured = this.config().get<string>('path', '').trim();
    if (configured) {
      const p = configured.startsWith('~') ? path.join(process.env.HOME ?? '', configured.slice(1)) : configured;
      if (exists(p)) return p;
    }
    const vault = findVaultDir(path.dirname(docUri.fsPath));
    if (vault) {
      const dir = path.join(vault, '.obsidian', 'themes');
      if (exists(dir)) return dir;
    }
    return null;
  }

  vaultDir(docUri: vscode.Uri): string | null {
    return findVaultDir(path.dirname(docUri.fsPath));
  }

  listThemes(docUri: vscode.Uri): ThemeEntry[] {
    const dir = this.themesDir(docUri);
    if (!dir) return [];
    const out: ThemeEntry[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const themeDir = path.join(dir, e.name);
      const cssPath = path.join(themeDir, 'theme.css');
      if (!exists(cssPath)) continue;
      let name = e.name;
      let author: string | undefined;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(themeDir, 'manifest.json'), 'utf8')) as { name?: string; author?: string };
        if (manifest.name) name = manifest.name;
        author = manifest.author;
      } catch {
        /* no manifest */
      }
      out.push({ name, id: e.name, dir: themeDir, cssPath, author });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private appearance(vault: string | null): { cssTheme?: string; theme?: string; enabledCssSnippets?: string[] } {
    if (!vault) return {};
    try {
      return JSON.parse(fs.readFileSync(path.join(vault, '.obsidian', 'appearance.json'), 'utf8'));
    } catch {
      return {};
    }
  }

  resolve(docUri: vscode.Uri): ResolvedTheme {
    const cfg = this.config();
    const requested = cfg.get<string>('name', 'auto').trim();
    const mode = cfg.get<ThemeMode>('mode', 'auto');
    const accentColor = cfg.get<string>('accentColor', '').trim();
    const vault = this.vaultDir(docUri);
    const appearance = this.appearance(vault);
    const themes = this.listThemes(docUri);

    let kind: ResolvedTheme['kind'] = 'vscode';
    let name = 'Follow VS Code';
    const cssPaths: string[] = [];

    const pick = (id: string) => themes.find((t) => t.id === id || t.name === id);
    if (requested === 'vscode' || requested === '') {
      kind = 'vscode';
    } else if (requested === 'obsidian') {
      kind = 'obsidian';
      name = 'Obsidian';
    } else if (requested === 'auto') {
      const auto = appearance.cssTheme ? pick(appearance.cssTheme) : undefined;
      if (auto) {
        kind = 'theme';
        name = auto.name;
        cssPaths.push(auto.cssPath);
      } else if (vault) {
        kind = 'obsidian';
        name = 'Obsidian';
      }
    } else {
      const t = pick(requested);
      if (t) {
        kind = 'theme';
        name = t.name;
        cssPaths.push(t.cssPath);
      } else {
        kind = 'obsidian';
        name = `Obsidian (theme "${requested}" not found)`;
      }
    }

    // Snippets: configured ones plus (in auto mode) the vault's enabled snippets.
    const snippetNames = new Set<string>(cfg.get<string[]>('snippets', []));
    if (requested === 'auto') for (const s of appearance.enabledCssSnippets ?? []) snippetNames.add(s);
    for (const s of snippetNames) {
      if (!s) continue;
      let p = s;
      if (!path.isAbsolute(p)) {
        if (!vault) continue;
        p = path.join(vault, '.obsidian', 'snippets', p.endsWith('.css') ? p : `${p}.css`);
      }
      if (exists(p)) cssPaths.push(p);
    }

    this.watch(cssPaths);
    return { name, kind, cssPaths, mode, accentColor };
  }

  toThemeInfo(webview: vscode.Webview, extensionUri: vscode.Uri, resolved: ResolvedTheme): ThemeInfo {
    const cssUris: string[] = [];
    if (resolved.kind === 'vscode') {
      cssUris.push(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'css', 'vscode-bridge.css')).toString());
    }
    for (const p of resolved.cssPaths) {
      let stamp = '';
      try {
        stamp = String(Math.floor(fs.statSync(p).mtimeMs));
      } catch {
        /* ignore */
      }
      cssUris.push(`${webview.asWebviewUri(vscode.Uri.file(p)).toString()}?v=${stamp}`);
    }
    let extraCss = '';
    const hsl = resolved.accentColor ? hexToHsl(resolved.accentColor) : null;
    if (hsl) extraCss += `body{--accent-h:${hsl.h};--accent-s:${hsl.s}%;--accent-l:${hsl.l}%;}`;
    return { name: resolved.name, kind: resolved.kind, cssUris, mode: resolved.mode, extraCss };
  }

  /** Roots the webview must be allowed to load for this theme. */
  resourceRoots(docUri: vscode.Uri, resolved: ResolvedTheme): vscode.Uri[] {
    const roots = new Set<string>();
    for (const p of resolved.cssPaths) roots.add(path.dirname(p));
    const themesDir = this.themesDir(docUri);
    if (themesDir) roots.add(themesDir);
    const vault = this.vaultDir(docUri);
    if (vault) roots.add(path.join(vault, '.obsidian'));
    return [...roots].map((p) => vscode.Uri.file(p));
  }

  private watch(paths: string[]) {
    const wanted = new Set(paths);
    for (const [p, w] of this.watchers) {
      if (!wanted.has(p)) {
        w.close();
        this.watchers.delete(p);
      }
    }
    for (const p of wanted) {
      if (this.watchers.has(p)) continue;
      try {
        const w = fs.watch(p, { persistent: false }, () => this.fire());
        w.on('error', () => {
          /* ignore */
        });
        this.watchers.set(p, w);
      } catch {
        /* ignore */
      }
    }
  }

  reload() {
    this.emitter.fire();
  }

  dispose() {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
