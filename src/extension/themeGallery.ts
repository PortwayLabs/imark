// Theme manager panel: browse / install the Obsidian community themes, switch
// between installed themes, update, remove and clean up the library.
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { DEFAULT_THEME, type LibraryTheme, type ThemeManager } from './themeManager';
import { dirSize, screenshotUrl, type Catalog, type CatalogEntry } from './themeCatalog';
import type { GalleryState, GalleryTheme, GalleryToHost, HostToGallery } from '../shared/galleryProtocol';

export interface GalleryDeps {
  /** Run the existing "Import Obsidian theme…" flow. */
  importThemes(): Promise<unknown>;
}

const zh = () => vscode.env.language.toLowerCase().startsWith('zh');
const t = (en: string, cn: string) => (zh() ? cn : en);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export class ThemeGallery implements vscode.Disposable {
  private static instance: ThemeGallery | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private catalog: Catalog | null = null;
  private catalogLoading = false;
  private updates: Record<string, string> = {};
  private checkingUpdates = false;
  private readonly busy = new Map<string, string>();
  private pushTimer: NodeJS.Timeout | undefined;

  static show(context: vscode.ExtensionContext, themes: ThemeManager, deps: GalleryDeps, tab: 'installed' | 'community' = 'installed'): void {
    if (ThemeGallery.instance) {
      ThemeGallery.instance.panel.reveal();
      ThemeGallery.instance.post({ type: 'tab', tab });
      return;
    }
    ThemeGallery.instance = new ThemeGallery(context, themes, deps, tab);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly themes: ThemeManager,
    private readonly deps: GalleryDeps,
    private readonly initialTab: 'installed' | 'community',
  ) {
    this.panel = vscode.window.createWebviewPanel('imark.themes', t('iMark Themes', 'iMark 主题'), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'imark.png');
    this.panel.webview.html = this.html();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: GalleryToHost) => void this.onMessage(m)),
      themes.onDidChange(() => this.schedulePush()),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  dispose(): void {
    ThemeGallery.instance = undefined;
    clearTimeout(this.pushTimer);
    for (const d of this.disposables) d.dispose();
  }

  private post(msg: HostToGallery) {
    void this.panel.webview.postMessage(msg);
  }

  // ---- state -------------------------------------------------------------------------

  private schedulePush() {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), 80);
  }

  private async loadCatalog(force: boolean) {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    this.schedulePush();
    try {
      this.catalog = await this.themes.getCatalog(force);
      if (this.catalog.error) this.themes.log(`Community theme list: ${this.catalog.error}`);
    } finally {
      this.catalogLoading = false;
      this.schedulePush();
    }
  }

  private entry(name: string): CatalogEntry | undefined {
    const key = name.toLowerCase();
    return this.catalog?.entries.find((e) => e.name.toLowerCase() === key);
  }

  private currentThemeId(): string {
    let v = vscode.workspace.getConfiguration('imark.theme').get<string>('name', DEFAULT_THEME).trim();
    if (!v || v === 'auto') v = DEFAULT_THEME;
    return v;
  }

  private async push() {
    const installed = await this.themes.libraryThemes();
    const current = this.currentThemeId();
    const used = this.themes.themesInUse();
    const byName = new Map<string, GalleryTheme>();
    const fromInstalled = (lt: LibraryTheme): GalleryTheme => {
      const e = this.entry(lt.name) ?? (lt.install ? this.catalog?.entries.find((x) => x.repo === lt.install!.repo) : undefined);
      return {
        name: lt.name,
        author: lt.author ?? e?.author ?? '',
        repo: e?.repo ?? lt.install?.repo,
        screenshot: e ? screenshotUrl(e) : undefined,
        modes: e?.modes ?? ['dark', 'light'],
        community: !!e,
        id: lt.id,
        installed: true,
        origin: lt.origin,
        version: lt.install?.version ?? lt.version,
        size: lt.size,
        inUse: lt.inUse,
        current: current === lt.id || current === lt.name,
        update: this.updates[lt.id],
      };
    };
    for (const lt of installed) byName.set(lt.name.toLowerCase(), fromInstalled(lt));
    const specials: GalleryTheme[] = [
      {
        name: t('Follow VS Code', '跟随 VS Code'),
        author: 'iMark',
        modes: ['dark', 'light'],
        community: false,
        id: 'vscode',
        installed: true,
        origin: 'special',
        inUse: used.has('vscode'),
        current: current === 'vscode',
        description: t('Maps Obsidian variables to the VS Code color theme.', '把 Obsidian 变量映射到 VS Code 配色主题。'),
      },
      {
        name: t('Obsidian default', 'Obsidian 默认'),
        author: 'iMark',
        modes: ['dark', 'light'],
        community: false,
        id: 'obsidian',
        installed: true,
        origin: 'special',
        inUse: used.has('obsidian'),
        current: current === 'obsidian',
        description: t("Obsidian's default look.", 'Obsidian 默认外观。'),
      },
    ];
    const list: GalleryTheme[] = [...specials, ...byName.values()];
    for (const e of this.catalog?.entries ?? []) {
      if (byName.has(e.name.toLowerCase())) continue;
      list.push({
        name: e.name,
        author: e.author,
        repo: e.repo,
        screenshot: screenshotUrl(e),
        modes: e.modes,
        community: true,
        installed: false,
        inUse: false,
        current: false,
      });
    }
    const state: GalleryState = {
      lang: zh() ? 'zh' : 'en',
      themes: list,
      catalog: { count: this.catalog?.entries.length ?? 0, fetchedAt: this.catalog?.fetchedAt ?? 0, loading: this.catalogLoading, error: this.catalog?.error },
      busy: Object.fromEntries(this.busy),
      checkingUpdates: this.checkingUpdates,
      libraryBytes: installed.filter((x) => x.origin === 'library').reduce((n, x) => n + x.size, 0),
      cacheBytes: await dirSize(this.themes.cacheDir),
      libraryDir: this.themes.libraryDir,
    };
    this.post({ type: 'state', state });
  }

  // ---- actions --------------------------------------------------------------------------

  private async withBusy(name: string, label: string, fn: () => Promise<void>) {
    if (this.busy.has(name)) return;
    this.busy.set(name, label);
    this.schedulePush();
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.themes.log(msg);
      void vscode.window.showErrorMessage(`iMark: ${msg}`);
    } finally {
      this.busy.delete(name);
      this.schedulePush();
    }
  }

  private async onMessage(m: GalleryToHost) {
    switch (m.type) {
      case 'ready':
        this.post({ type: 'tab', tab: this.initialTab });
        await this.push();
        await this.loadCatalog(false);
        break;
      case 'refresh':
        await this.loadCatalog(true);
        break;
      case 'install':
      case 'update': {
        const e = this.entry(m.name);
        if (!e) return;
        await this.withBusy(e.name, m.type === 'install' ? 'installing' : 'updating', async () => {
          const theme = await this.themes.installCommunity(e);
          delete this.updates[theme.id];
          if (m.type === 'install') {
            const use = t('Use this theme', '使用此主题');
            const choice = await vscode.window.showInformationMessage(t(`iMark installed theme "${theme.name}".`, `iMark 已安装主题“${theme.name}”。`), use);
            if (choice === use) await this.themes.setTheme(theme.id);
          } else {
            void vscode.window.showInformationMessage(t(`iMark updated theme "${theme.name}".`, `iMark 已更新主题“${theme.name}”。`));
          }
        });
        break;
      }
      case 'use':
        await this.themes.setTheme(m.id);
        this.schedulePush();
        break;
      case 'remove': {
        const theme = this.themes.listThemes().find((x) => x.id === m.id && x.origin === 'library');
        if (!theme) return;
        const remove = t('Remove', '删除');
        const ok = await vscode.window.showWarningMessage(t(`Remove theme "${theme.name}" from iMark?`, `从 iMark 删除主题“${theme.name}”？`), { modal: true }, remove);
        if (ok !== remove) return;
        await this.withBusy(theme.name, 'removing', async () => {
          await this.themes.removeTheme(theme.id);
          const current = this.currentThemeId();
          if (current === theme.id || current === theme.name) await this.themes.setTheme(DEFAULT_THEME);
        });
        break;
      }
      case 'checkUpdates':
        if (this.checkingUpdates) return;
        this.checkingUpdates = true;
        this.schedulePush();
        try {
          if (!this.catalog?.entries.length) await this.loadCatalog(false);
          this.updates = await this.themes.checkUpdates(this.catalog?.entries ?? []);
          const n = Object.keys(this.updates).length;
          void vscode.window.showInformationMessage(n ? t(`iMark: ${n} theme update(s) available.`, `iMark：${n} 个主题有更新。`) : t('iMark: all themes are up to date.', 'iMark：所有主题均为最新。'));
        } finally {
          this.checkingUpdates = false;
          this.schedulePush();
        }
        break;
      case 'cleanup':
        await this.cleanUp();
        break;
      case 'import':
        await this.deps.importThemes();
        this.schedulePush();
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.themes.libraryDir));
        break;
      case 'openUrl':
        if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
        break;
    }
  }

  private async cleanUp() {
    const lib = (await this.themes.libraryThemes()).filter((x) => x.origin === 'library');
    const unused = lib.filter((x) => !x.inUse);
    const unusedBytes = unused.reduce((n, x) => n + x.size, 0);
    const cacheBytes = await dirSize(this.themes.cacheDir);
    const removeUnused = t(`Remove ${unused.length} unused theme(s)`, `删除 ${unused.length} 个未使用的主题`);
    const cacheOnly = t('Clear cache only', '仅清理缓存');
    const items = unused.length ? [removeUnused, cacheOnly] : [cacheOnly];
    const detail = unused.length
      ? t(
          `Unused themes (${formatBytes(unusedBytes)}): ${unused.map((x) => x.name).join(', ')}.\nThemes selected in any settings scope are kept. The download cache is ${formatBytes(cacheBytes)}.`,
          `未使用的主题（${formatBytes(unusedBytes)}）：${unused.map((x) => x.name).join('、')}。\n任一设置范围中正在使用的主题会保留。下载缓存 ${formatBytes(cacheBytes)}。`,
        )
      : t(`No unused themes. The download cache is ${formatBytes(cacheBytes)}.`, `没有未使用的主题。下载缓存 ${formatBytes(cacheBytes)}。`);
    const choice = await vscode.window.showWarningMessage(t('Clean up the iMark theme library?', '清理 iMark 主题库？'), { modal: true, detail }, ...items);
    if (!choice) return;
    const result = await this.themes.cleanUp({ unused: choice === removeUnused, cache: true });
    this.catalog = null;
    void this.loadCatalog(false);
    void vscode.window.showInformationMessage(
      t(
        `iMark: removed ${result.removed.length} theme(s), freed ${formatBytes(result.freedBytes)}.`,
        `iMark：已删除 ${result.removed.length} 个主题，释放 ${formatBytes(result.freedBytes)}。`,
      ),
    );
  }

  // ---- HTML ---------------------------------------------------------------------------------

  private html(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const res = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p)).toString();
    const csp = [
      `default-src 'none'`,
      // Screenshots come from the theme repositories on GitHub.
      `img-src ${webview.cspSource} https://raw.githubusercontent.com https://github.com https://*.githubusercontent.com data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="${zh() ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>iMark Themes</title>
<link rel="stylesheet" href="${res('media', 'css', 'gallery.css')}">
</head>
<body>
<div id="app" aria-live="polite"></div>
<script nonce="${nonce}" src="${res('dist', 'gallery', 'main.js')}"></script>
</body>
</html>`;
  }
}

