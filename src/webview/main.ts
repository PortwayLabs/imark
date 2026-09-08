// Webview entry point: builds the Obsidian-like DOM shell, hosts the CodeMirror
// editor and the reading view, and keeps the document in sync with VS Code.
import type { ViewUpdate } from '@codemirror/view';
import type {
  DocumentInfo,
  EditorConfig,
  EditorMode,
  FileContentMessage,
  HostMessage,
  InitMessage,
  TextChange,
  ThemeInfo,
} from '../shared/protocol';
import { diffChange } from '../shared/protocol';
import { host } from './host';
import { LinkResolver } from './links';
import { createEditor, externalChange, type EditorHandle } from './editor/createEditor';
import type { WidgetContext } from './editor/widgets';
import { renderMarkdown } from './render/markdownIt';
import { hydrateRendered } from './render/hydrate';
import { createHeader, type HeaderHandle } from './ui/header';
import { setMermaidDark } from './render/mermaid';

interface SavedState {
  mode?: EditorMode;
  scrollTop?: number;
}

const platformClass: Record<string, string> = { mac: 'mod-macos', win: 'mod-windows', linux: 'mod-linux' };

class App {
  root!: HTMLElement;
  leafContent!: HTMLElement;
  viewContent!: HTMLElement;
  sourceView!: HTMLElement;
  readingView!: HTMLElement;
  readingSizer!: HTMLElement;
  header: HeaderHandle | null = null;
  editor: EditorHandle | null = null;
  resolver: LinkResolver | null = null;
  config!: EditorConfig;
  doc!: DocumentInfo;
  mode: EditorMode = 'live';
  gen = 0;
  theme: ThemeInfo | null = null;
  readingDirty = true;
  renderTimer: number | undefined;
  statsTimer: number | undefined;
  readFileCache = new Map<string, Promise<string | null>>();

  constructor() {
    this.buildShell();
    host.onMessage((m) => this.onHostMessage(m));
    host.post({ type: 'ready' });
    window.addEventListener('focus', () => host.post({ type: 'webviewFocus', focused: true }));
    window.addEventListener('blur', () => host.post({ type: 'webviewFocus', focused: false }));
    // Follow VS Code's light/dark class when theme mode is `auto`.
    new MutationObserver(() => this.applyThemeMode()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // ---- DOM -----------------------------------------------------------------------

  buildShell() {
    const el = (cls: string, tag = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      return e;
    };
    this.root = el('app-container');
    const main = el('horizontal-main-container');
    const workspace = el('workspace');
    const split = el('workspace-split mod-vertical mod-root');
    const tabs = el('workspace-tabs mod-top mod-top-left-space mod-top-right-space');
    const tabContainer = el('workspace-tab-container');
    const leaf = el('workspace-leaf mod-active');
    this.leafContent = el('workspace-leaf-content');
    this.leafContent.setAttribute('data-type', 'markdown');
    this.leafContent.setAttribute('data-mode', 'source');
    this.viewContent = el('view-content');
    this.sourceView = el('markdown-source-view cm-s-obsidian mod-cm6 node-insert-event is-live-preview is-folding show-properties');
    this.readingView = el('markdown-reading-view');
    const preview = el('markdown-preview-view markdown-rendered node-insert-event allow-fold-headings show-indentation-guide allow-fold-lists show-properties show-frontmatter');
    preview.setAttribute('tabindex', '-1');
    this.readingSizer = el('markdown-preview-sizer markdown-preview-section');
    preview.appendChild(this.readingSizer);
    this.readingView.appendChild(preview);
    this.readingView.style.display = 'none';
    this.viewContent.append(this.sourceView, this.readingView);
    this.leafContent.appendChild(this.viewContent);
    leaf.appendChild(this.leafContent);
    tabContainer.appendChild(leaf);
    tabs.appendChild(tabContainer);
    split.appendChild(tabs);
    workspace.appendChild(split);
    main.appendChild(workspace);
    this.root.appendChild(main);
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.onRenderedClick(e));
  }

  // ---- messages --------------------------------------------------------------------

  onHostMessage(msg: HostMessage) {
    switch (msg.type) {
      case 'init':
        this.init(msg);
        break;
      case 'update':
        this.applyExternal(msg.text, msg.gen);
        break;
      case 'theme':
        this.applyTheme(msg.theme);
        break;
      case 'config':
        this.applyConfig(msg.config);
        break;
      case 'setMode':
        this.setMode(msg.mode);
        break;
      case 'toggleReading':
        this.setMode(this.mode === 'reading' ? (host.getState<SavedState>()?.mode === 'source' ? 'source' : 'live') : 'reading');
        break;
      case 'toggleSource':
        this.setMode(this.mode === 'source' ? 'live' : 'source');
        break;
      case 'fileIndex':
        if (this.resolver) {
          this.resolver.setFiles(msg.files);
          this.readFileCache.clear();
          this.editor?.setWidgetContext(this.widgetContext());
          this.readingDirty = true;
          if (this.mode === 'reading') this.renderReading();
        }
        break;
      case 'documentInfo':
        this.doc = msg.doc;
        if (this.resolver) this.resolver.doc = msg.doc;
        this.editor?.setTitle(msg.doc.title);
        this.header?.update({ title: msg.doc.title });
        break;
      case 'focus':
        this.editor?.view.focus();
        break;
    }
  }

  init(msg: InitMessage) {
    this.config = msg.config;
    this.doc = msg.doc;
    this.gen = msg.gen;
    this.resolver = new LinkResolver(msg.roots, msg.doc, msg.files);
    document.body.classList.add('imark', platformClass[msg.config.platform] ?? 'mod-linux');
    this.applyTheme(msg.theme);

    const saved = host.getState<SavedState>();
    const initialMode = saved?.mode ?? msg.config.mode;

    this.header = createHeader({
      title: msg.doc.title,
      mode: initialMode,
      readable: msg.config.readableLineWidth,
      onToggleReading: () => this.setMode(this.mode === 'reading' ? (saved?.mode === 'source' ? 'source' : 'live') : 'reading'),
      onMenu: (action) => {
        if (action === 'toggleSource') this.setMode(this.mode === 'source' ? 'live' : 'source');
        else if (action === 'toggleReadable') host.post({ type: 'command', command: 'toggleReadableLineWidth' });
        else if (action === 'openSource') host.post({ type: 'command', command: 'openSource' });
        else if (action === 'selectTheme') host.post({ type: 'command', command: 'selectTheme' });
      },
    });
    this.leafContent.insertBefore(this.header.el, this.viewContent);
    this.header.el.style.display = msg.config.showHeader ? '' : 'none';

    this.editor = createEditor({
      parent: this.sourceView,
      doc: msg.text,
      config: msg.config,
      title: msg.doc.title,
      live: initialMode !== 'source',
      widgetCtx: this.widgetContext(),
      getResolver: () => this.resolver,
      actions: {
        toggleReading: () => this.setMode(this.mode === 'reading' ? 'live' : 'reading'),
        toggleSource: () => this.setMode(this.mode === 'source' ? 'live' : 'source'),
        followLink: () => false,
      },
      onUpdate: (u) => this.onEditorUpdate(u),
      openLink: (kind, target) => this.openLink(kind, target),
    });
    this.applyConfig(msg.config, true);
    this.setMode(initialMode, true);
    this.postStats();
    if (initialMode !== 'reading') this.editor.view.focus();
  }

  widgetContext(): WidgetContext {
    return {
      resolver: this.resolver!,
      openLink: (href) => this.openLink('url', href),
      openWikilink: (target) => this.openLink('wikilink', target),
      readFile: (target) => this.readFile(target),
    };
  }

  readFile(target: string): Promise<string | null> {
    let p = this.readFileCache.get(target);
    if (!p) {
      p = host
        .request<FileContentMessage>((id) => ({ type: 'readFile', id, target }))
        .then((m) => m.text)
        .catch(() => null);
      this.readFileCache.set(target, p);
    }
    return p;
  }

  openLink(kind: 'url' | 'wikilink' | 'tag', target: string) {
    if (kind === 'tag') host.post({ type: 'searchTag', tag: target });
    else if (kind === 'wikilink') host.post({ type: 'openWikilink', target });
    else host.post({ type: 'openLink', href: target });
  }

  // ---- sync -------------------------------------------------------------------------

  onEditorUpdate(u: ViewUpdate) {
    if (u.docChanged) {
      const external = u.transactions.some((tr) => tr.annotation(externalChange));
      if (!external) {
        const changes: TextChange[] = [];
        u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changes.push({ from: fromA, to: toA, insert: inserted.toString() });
        });
        host.post({ type: 'edit', gen: this.gen, changes });
      }
      this.readFileCache.clear();
      this.readingDirty = true;
      if (this.mode === 'reading') this.scheduleRender();
      this.scheduleStats();
    }
  }

  applyExternal(text: string, gen: number) {
    this.gen = gen;
    if (!this.editor) return;
    const view = this.editor.view;
    const current = view.state.doc.toString();
    const change = diffChange(current, text);
    if (!change) return;
    view.dispatch({ changes: change, annotations: externalChange.of(true) });
  }

  // ---- modes ---------------------------------------------------------------------------

  setMode(mode: EditorMode, initial = false) {
    const prev = this.mode;
    this.mode = mode;
    const saved = host.getState<SavedState>() ?? {};
    host.setState({ ...saved, mode });
    this.leafContent.setAttribute('data-mode', mode === 'reading' ? 'preview' : 'source');
    this.sourceView.classList.toggle('is-live-preview', mode === 'live');
    this.header?.update({ mode });
    if (mode === 'reading') {
      this.renderReading();
      this.sourceView.style.display = 'none';
      this.readingView.style.display = '';
    } else {
      this.readingView.style.display = 'none';
      this.sourceView.style.display = '';
      this.editor?.setLive(mode === 'live');
      if (!initial) this.editor?.view.focus();
    }
    if (!initial || prev !== mode) host.post({ type: 'modeChanged', mode });
  }

  scheduleRender() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.renderReading(), 150);
  }

  renderReading() {
    if (!this.editor || !this.resolver) return;
    if (!this.readingDirty && this.readingSizer.childElementCount) return;
    const text = this.editor.view.state.doc.toString();
    const ctx = { resolver: this.resolver, depth: 0 };
    const title = this.config.showInlineTitle ? `<div class="mod-header"><div class="inline-title" tabindex="-1">${escapeHtml(this.doc.title)}</div></div>` : '';
    this.readingSizer.innerHTML = `<div class="markdown-preview-pusher"></div>${title}${renderMarkdown(text, ctx)}<div class="mod-footer"></div>`;
    hydrateRendered(this.readingSizer, ctx, (t) => this.readFile(t));
    this.readingDirty = false;
  }

  onRenderedClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const inRendered = target.closest('.markdown-rendered, .markdown-preview-view');
    if (!inRendered) return;
    const checkbox = target.closest<HTMLInputElement>('input.task-list-item-checkbox[data-line]');
    if (checkbox && this.editor && this.mode === 'reading') {
      e.preventDefault();
      const lineNo = parseInt(checkbox.getAttribute('data-line') ?? '-1', 10);
      const doc = this.editor.view.state.doc;
      if (lineNo >= 0 && lineNo < doc.lines) {
        const line = doc.line(lineNo + 1);
        const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)\]/.exec(line.text);
        if (m) {
          const pos = line.from + m[1].length;
          this.editor.view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[2] === ' ' ? 'x' : ' ' } });
        }
      }
      return;
    }
    const a = target.closest<HTMLAnchorElement>('a');
    if (a) {
      e.preventDefault();
      if (a.classList.contains('tag')) this.openLink('tag', a.textContent?.replace(/^#/, '') ?? '');
      else if (a.classList.contains('internal-link')) this.openLink('wikilink', a.getAttribute('data-href') ?? a.getAttribute('href') ?? '');
      else if (a.classList.contains('footnote-ref') || a.classList.contains('footnote-backref') || (a.getAttribute('href') ?? '').startsWith('#')) {
        const id = (a.getAttribute('href') ?? '').slice(1);
        document.getElementById(id)?.scrollIntoView({ block: 'center' });
      } else this.openLink('url', a.getAttribute('href') ?? '');
      return;
    }
    const embedLink = target.closest<HTMLElement>('.markdown-embed-link');
    if (embedLink) {
      const src = embedLink.parentElement?.getAttribute('src');
      if (src) this.openLink('wikilink', src);
    }
  }

  // ---- theme / config ---------------------------------------------------------------------

  applyTheme(theme: ThemeInfo) {
    this.theme = theme;
    document.querySelectorAll('link[data-imark-theme], style[data-imark-theme]').forEach((n) => n.remove());
    document.body.classList.toggle('imark-vscode-bridge', theme.kind === 'vscode');
    const head = document.head;
    theme.cssUris.forEach((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-imark-theme', '1');
      head.appendChild(link);
    });
    if (theme.extraCss) {
      const style = document.createElement('style');
      style.setAttribute('data-imark-theme', '1');
      style.textContent = theme.extraCss;
      head.appendChild(style);
    }
    this.applyThemeMode();
  }

  applyThemeMode() {
    const mode = this.theme?.mode ?? 'auto';
    let dark: boolean;
    if (mode === 'dark') dark = true;
    else if (mode === 'light') dark = false;
    else {
      // VS Code marks the webview body with vscode-dark / vscode-light / vscode-high-contrast(-light).
      const b = document.body.classList;
      const known = ['vscode-dark', 'vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light', 'imark-prefers-dark', 'imark-prefers-light'].some((c) => b.contains(c));
      if (!known) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      else dark = b.contains('vscode-dark') || b.contains('imark-prefers-dark') || (b.contains('vscode-high-contrast') && !b.contains('vscode-high-contrast-light'));
    }
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    void setMermaidDark(dark).then((changed) => {
      if (!changed) return;
      this.editor?.refreshWidgets();
      this.readingDirty = true;
      if (this.mode === 'reading') this.renderReading();
    });
  }

  applyConfig(cfg: EditorConfig, initial = false) {
    this.config = cfg;
    this.sourceView.classList.toggle('is-readable-line-width', cfg.readableLineWidth);
    this.sourceView.classList.toggle('imark-line-numbers', cfg.lineNumbers);
    this.sourceView.classList.toggle('imark-wide-tables', cfg.wideTables);
    this.readingView.querySelector('.markdown-preview-view')?.classList.toggle('imark-wide-tables', cfg.wideTables);
    this.sourceView.classList.toggle('imark-table-natural', cfg.tableLayout === 'natural');
    this.readingView.querySelector('.markdown-preview-view')?.classList.toggle('imark-table-natural', cfg.tableLayout === 'natural');
    this.readingView.querySelector('.markdown-preview-view')?.classList.toggle('is-readable-line-width', cfg.readableLineWidth);
    document.body.style.setProperty('--imark-font-size-override', cfg.fontSize > 0 ? `${cfg.fontSize}px` : '');
    document.body.classList.toggle('imark-font-size-override', cfg.fontSize > 0);
    if (this.header) {
      this.header.el.style.display = cfg.showHeader ? '' : 'none';
      this.header.update({ readable: cfg.readableLineWidth });
    }
    if (!initial) {
      this.editor?.setConfig(cfg);
      this.readingDirty = true;
      if (this.mode === 'reading') this.renderReading();
    }
  }

  // ---- stats ----------------------------------------------------------------------------

  scheduleStats() {
    window.clearTimeout(this.statsTimer);
    this.statsTimer = window.setTimeout(() => this.postStats(), 400);
  }

  postStats() {
    if (!this.editor) return;
    const text = this.editor.view.state.doc.toString();
    const cjk = (text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g) ?? []).length;
    const words = (text.replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).length;
    host.post({ type: 'stats', words: words + cjk, characters: text.replace(/\s/g, '').length });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const app = new App();
// Exposed for the browser harness / debugging.
(window as unknown as { imark: App }).imark = app;
