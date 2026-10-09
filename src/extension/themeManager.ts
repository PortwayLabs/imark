// iMark's theme library: Obsidian themes / CSS snippets imported into the
// extension's global storage, selected through VS Code settings.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ThemeInfo, ThemeMode } from '../shared/protocol';
import { appearanceMode, copySnippet, copyTheme, findVaultDir, planImport, themeSource, themesIn, type ImportPlan, type ThemeSource } from './themeImport';
import {
  compareVersions,
  createFetch,
  dirSize,
  downloadTheme,
  fetchManifest,
  loadCatalog,
  readInstallInfo,
  writeTheme,
  type Catalog,
  type CatalogEntry,
  type FetchFn,
  type InstallInfo,
} from './themeCatalog';

export interface ThemeEntry extends ThemeSource {
  cssPath: string;
  /** `bundled` = shipped with iMark, `library` = imported into iMark, `external` = from `imark.theme.path`. */
  origin: 'bundled' | 'library' | 'external';
}

/** Theme shipped with the extension and used when nothing else is configured. */
export const DEFAULT_THEME = 'Monokai Syntax';

export interface ResolvedTheme {
  name: string;
  kind: 'vscode' | 'obsidian' | 'theme';
  cssPaths: string[];
  mode: ThemeMode;
  accentColor: string;
  /** Set when the configured theme could not be found. */
  missing?: string;
}

/** A theme in iMark's library with management details (for the theme manager). */
export interface LibraryTheme extends ThemeEntry {
  /** Bytes on disk (library themes only). */
  size: number;
  /** Set for themes installed from the community catalog. */
  install: InstallInfo | null;
  /** Selected in user, workspace or folder settings. */
  inUse: boolean;
}

export interface CleanupResult {
  removed: string[];
  freedBytes: number;
}

export interface ImportResult {
  themes: ThemeEntry[];
  snippets: string[];
  plan: ImportPlan;
}

const exists = (p: string) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

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
  readonly libraryDir: string;
  readonly snippetsDir: string;
  readonly bundledDir: string;
  readonly cacheDir: string;
  /** VS Code applies its proxy settings to `https`; when the direct request fails anyway,
   *  retry through `http.proxy` / `HTTPS_PROXY` explicitly. */
  private readonly fetchFn: FetchFn = async (url, init) => {
    try {
      return await this.directFetch(url, init);
    } catch (e) {
      const proxy = vscode.workspace.getConfiguration('http').get<string>('proxy', '').trim() || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
      if (!/^http:\/\//i.test(proxy) || init?.signal?.aborted) throw e;
      return createFetch({ proxy })(url, init);
    }
  };
  private readonly directFetch: FetchFn = createFetch();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.bundledDir = path.join(context.extensionUri.fsPath, 'media', 'themes');
    this.libraryDir = path.join(context.globalStorageUri.fsPath, 'themes');
    this.snippetsDir = path.join(context.globalStorageUri.fsPath, 'snippets');
    this.cacheDir = path.join(context.globalStorageUri.fsPath, 'cache');
    fs.mkdirSync(this.libraryDir, { recursive: true });
    fs.mkdirSync(this.snippetsDir, { recursive: true });
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('imark.theme')) this.fire();
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.fire()),
    );
  }

  private output: vscode.OutputChannel | undefined;

  /** Append a line to the "iMark" output channel (created on first use). */
  log(line: string): void {
    this.output ??= vscode.window.createOutputChannel('iMark');
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }

  private fire() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.emitter.fire(), 120);
  }

  private config() {
    return vscode.workspace.getConfiguration('imark.theme');
  }

  /** Optional extra directory of themes configured by the user (read-only, never written). */
  externalDir(): string | null {
    const configured = this.config().get<string>('path', '').trim();
    if (!configured) return null;
    const p = configured.startsWith('~') ? path.join(process.env.HOME ?? '', configured.slice(1)) : configured;
    return exists(p) ? p : null;
  }

  listThemes(): ThemeEntry[] {
    const entry = (origin: ThemeEntry['origin']) => (t: ThemeSource): ThemeEntry => ({ ...t, cssPath: path.join(t.dir, 'theme.css'), origin });
    const bundled = themesIn(this.bundledDir).map(entry('bundled'));
    const lib = themesIn(this.libraryDir).map(entry('library'));
    const ext = this.externalDir();
    const external = ext ? themesIn(ext).map(entry('external')) : [];
    // A theme imported by the user shadows a bundled/external one with the same id.
    const out: ThemeEntry[] = [...lib];
    const ids = new Set(lib.map((t) => t.id));
    for (const t of [...bundled, ...external]) {
      if (ids.has(t.id)) continue;
      ids.add(t.id);
      out.push(t);
    }
    return out;
  }

  findTheme(idOrName: string): ThemeEntry | undefined {
    const themes = this.listThemes();
    return themes.find((t) => t.id === idOrName) ?? themes.find((t) => t.name === idOrName);
  }

  /** Suggested folder for the import dialog: the current vault's `.obsidian/themes` if any. */
  suggestedImportDir(docUri?: vscode.Uri): vscode.Uri | undefined {
    const starts = [docUri ? path.dirname(docUri.fsPath) : null, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)].filter((s): s is string => !!s);
    for (const s of starts) {
      const vault = findVaultDir(s);
      if (vault) {
        const themes = path.join(vault, '.obsidian', 'themes');
        return vscode.Uri.file(exists(themes) ? themes : vault);
      }
    }
    return undefined;
  }

  /** Import themes / snippets from user-picked paths into the library. */
  async importFrom(paths: string[]): Promise<ImportResult> {
    const result: ImportResult = { themes: [], snippets: [], plan: { themes: [], snippets: [], appearance: null, vaultSnippetsDir: null } };
    for (const p of paths) {
      const plan = planImport(p);
      result.plan.themes.push(...plan.themes);
      result.plan.snippets.push(...plan.snippets);
      if (plan.appearance && !result.plan.appearance) {
        result.plan.appearance = plan.appearance;
        result.plan.vaultSnippetsDir = plan.vaultSnippetsDir;
      }
      for (const t of plan.themes) {
        const target = await copyTheme(t, this.libraryDir);
        const entry = themeSource(target);
        if (entry) result.themes.push({ ...entry, cssPath: path.join(target, 'theme.css'), origin: 'library' });
      }
      for (const s of plan.snippets) result.snippets.push(await copySnippet(s, this.snippetsDir));
    }
    this.fire();
    return result;
  }

  async removeTheme(id: string): Promise<boolean> {
    const dir = path.join(this.libraryDir, id);
    if (!exists(dir)) return false;
    await fs.promises.rm(dir, { recursive: true, force: true });
    this.fire();
    return true;
  }

  // ---- community themes ------------------------------------------------------------

  private get catalogFile(): string {
    return path.join(this.cacheDir, 'community-themes.json');
  }

  getCatalog(force = false): Promise<Catalog> {
    return loadCatalog(this.catalogFile, this.fetchFn, { force });
  }

  /** Download a community theme into the library (replacing an older copy). */
  async installCommunity(entry: CatalogEntry): Promise<ThemeEntry> {
    const downloaded = await downloadTheme(entry, this.fetchFn);
    const dir = await writeTheme(entry, downloaded, this.libraryDir);
    const t = themeSource(dir);
    if (!t) throw new Error(`theme "${entry.name}" was downloaded but could not be read`);
    this.fire();
    return { ...t, cssPath: path.join(dir, 'theme.css'), origin: 'library' };
  }

  /** Latest versions of library themes that exist in the catalog: id -> newer version. */
  async checkUpdates(entries: CatalogEntry[]): Promise<Record<string, string>> {
    const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
    const out: Record<string, string> = {};
    const lib = themesIn(this.libraryDir);
    await Promise.all(
      lib.map(async (t) => {
        const info = readInstallInfo(t.dir);
        const entry = (info && entries.find((e) => e.repo === info.repo)) ?? byName.get(t.name.toLowerCase()) ?? byName.get(t.id.toLowerCase());
        if (!entry) return;
        const m = await fetchManifest(entry, this.fetchFn);
        const latest = typeof m?.version === 'string' ? m.version : '';
        const installed = info?.version ?? t.version ?? '0.0.0';
        if (latest && compareVersions(installed, latest) < 0) out[t.id] = latest;
      }),
    );
    return out;
  }

  /** Theme ids selected anywhere in the settings (user, workspace, folders). */
  themesInUse(): Set<string> {
    const used = new Set<string>();
    const add = (v: unknown) => {
      if (typeof v === 'string' && v.trim()) used.add(v.trim());
    };
    const info = this.config().inspect<string>('name');
    add(info?.globalValue);
    add(info?.workspaceValue);
    add(info?.workspaceFolderValue);
    for (const f of vscode.workspace.workspaceFolders ?? []) add(vscode.workspace.getConfiguration('imark.theme', f.uri).inspect<string>('name')?.workspaceFolderValue);
    if (!info?.globalValue && !info?.workspaceValue) used.add(DEFAULT_THEME);
    // Names are accepted as well as ids.
    for (const t of this.listThemes()) if (used.has(t.name)) used.add(t.id);
    return used;
  }

  async libraryThemes(): Promise<LibraryTheme[]> {
    const used = this.themesInUse();
    return Promise.all(
      this.listThemes().map(async (t) => ({
        ...t,
        size: t.origin === 'library' ? await dirSize(t.dir) : 0,
        install: t.origin === 'library' ? readInstallInfo(t.dir) : null,
        inUse: used.has(t.id) || used.has(t.name),
      })),
    );
  }

  /** Remove library themes (by id) and/or the download cache. Themes in use are kept. */
  async cleanUp(opts: { themes?: string[]; unused?: boolean; cache?: boolean }): Promise<CleanupResult> {
    const result: CleanupResult = { removed: [], freedBytes: 0 };
    const used = this.themesInUse();
    const lib = themesIn(this.libraryDir);
    const targets = lib.filter((t) => (opts.unused ? true : (opts.themes ?? []).includes(t.id)) && !used.has(t.id) && !used.has(t.name));
    for (const t of targets) {
      result.freedBytes += await dirSize(t.dir);
      await fs.promises.rm(t.dir, { recursive: true, force: true });
      result.removed.push(t.name);
    }
    if (opts.cache) {
      for (const d of [this.cacheDir, path.join(path.dirname(this.libraryDir), 'tmp')]) {
        result.freedBytes += await dirSize(d);
        await fs.promises.rm(d, { recursive: true, force: true });
      }
    }
    if (result.removed.length) this.fire();
    return result;
  }

  /** Themes whose layout notice the user silenced (by display name). */
  quietIssues(name: string): boolean {
    return (this.context.globalState.get<string[]>('imark.quietThemeIssues') ?? []).includes(name);
  }

  async silenceIssues(name: string): Promise<void> {
    const list = new Set(this.context.globalState.get<string[]>('imark.quietThemeIssues') ?? []);
    list.add(name);
    await this.context.globalState.update('imark.quietThemeIssues', [...list]);
  }

  listSnippets(): string[] {
    try {
      return fs
        .readdirSync(this.snippetsDir)
        .filter((f) => f.toLowerCase().endsWith('.css'))
        .sort();
    } catch {
      return [];
    }
  }

  /** Apply a vault's appearance settings (theme, mode, accent, snippets) to VS Code settings. */
  async applyAppearance(plan: ImportPlan, imported: ImportResult): Promise<string[]> {
    const applied: string[] = [];
    const cfg = this.config();
    const a = plan.appearance;
    if (!a) return applied;
    if (a.cssTheme) {
      const t = imported.themes.find((x) => x.name === a.cssTheme || x.id === a.cssTheme) ?? this.findTheme(a.cssTheme);
      if (t) {
        await cfg.update('name', t.id, this.targetFor('name'));
        applied.push(`theme "${t.name}"`);
      }
    }
    const mode = appearanceMode(a.theme);
    if (mode) {
      await cfg.update('mode', mode, this.targetFor('mode'));
      applied.push(`mode ${mode}`);
    }
    if (a.accentColor && /^#?[0-9a-f]{3,6}$/i.test(a.accentColor)) {
      await cfg.update('accentColor', a.accentColor.startsWith('#') ? a.accentColor : `#${a.accentColor}`, this.targetFor('accentColor'));
      applied.push(`accent ${a.accentColor}`);
    }
    if (imported.snippets.length) {
      const names = imported.snippets.map((s) => path.basename(s));
      await cfg.update('snippets', names, this.targetFor('snippets'));
      applied.push(`${names.length} snippet(s)`);
    }
    return applied;
  }

  /** Update a setting where it is currently defined (workspace wins), defaulting to user settings. */
  targetFor(key: string): vscode.ConfigurationTarget {
    const info = this.config().inspect(key);
    if (info?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
    if (info?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
    return vscode.ConfigurationTarget.Global;
  }

  async setTheme(value: string): Promise<void> {
    await this.config().update('name', value, this.targetFor('name'));
  }

  resolve(_docUri?: vscode.Uri): ResolvedTheme {
    const cfg = this.config();
    let requested = cfg.get<string>('name', DEFAULT_THEME).trim();
    if (requested === 'auto' || requested === '') requested = DEFAULT_THEME;
    const mode = cfg.get<ThemeMode>('mode', 'auto');
    const accentColor = cfg.get<string>('accentColor', '').trim();

    let kind: ResolvedTheme['kind'] = 'vscode';
    let name = 'Follow VS Code';
    let missing: string | undefined;
    const cssPaths: string[] = [];

    if (requested === 'obsidian') {
      kind = 'obsidian';
      name = 'Obsidian';
    } else if (requested !== 'vscode') {
      const t = this.findTheme(requested);
      if (t) {
        kind = 'theme';
        name = t.name;
        cssPaths.push(t.cssPath);
      } else {
        missing = requested;
        const fallback = this.findTheme(DEFAULT_THEME);
        if (fallback) {
          kind = 'theme';
          name = `${fallback.name} (theme "${requested}" not found)`;
          cssPaths.push(fallback.cssPath);
        } else {
          kind = 'obsidian';
          name = `Obsidian (theme "${requested}" not found)`;
        }
      }
    }

    for (const s of cfg.get<string[]>('snippets', [])) {
      if (!s) continue;
      let p = s;
      if (!path.isAbsolute(p)) {
        const file = p.endsWith('.css') ? p : `${p}.css`;
        const candidates = [path.join(this.snippetsDir, file)];
        const ext = this.externalDir();
        if (ext) candidates.push(path.join(ext, file), path.join(path.dirname(ext), 'snippets', file));
        p = candidates.find(exists) ?? '';
      }
      if (p && exists(p)) cssPaths.push(p);
    }

    this.watch(cssPaths);
    return { name, kind, cssPaths, mode, accentColor, missing };
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
    const protection = this.config().get<ThemeInfo['protection']>('protection', 'auto');
    return { name: resolved.name, kind: resolved.kind, cssUris, mode: resolved.mode, extraCss, protection, quietIssues: this.quietIssues(resolved.name) };
  }

  /** Roots the webview must be allowed to load theme assets from. */
  resourceRoots(resolved: ResolvedTheme): vscode.Uri[] {
    const roots = new Set<string>([this.context.globalStorageUri.fsPath, this.bundledDir]);
    const ext = this.externalDir();
    if (ext) roots.add(ext);
    for (const p of resolved.cssPaths) roots.add(path.dirname(p));
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
    this.output?.dispose();
    this.emitter.dispose();
  }
}
