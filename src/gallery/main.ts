// Webview of the iMark theme manager: installed themes and the Obsidian
// community catalog as searchable card grids. All actions are executed by the
// extension host (src/extension/themeGallery.ts); this script only renders state.
import type { GalleryState, GalleryTheme, GalleryToHost, HostToGallery } from '../shared/galleryProtocol';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

const vscode = acquireVsCodeApi();
const post = (m: GalleryToHost) => vscode.postMessage(m);

type Tab = 'installed' | 'community';
type ModeFilter = 'all' | 'dark' | 'light';
interface UiState {
  tab: Tab;
  query: string;
  mode: ModeFilter;
}

const STR = {
  en: {
    title: 'Themes',
    installed: 'Installed',
    community: 'Community',
    search: 'Search themes or authors',
    all: 'All modes',
    dark: 'Dark',
    light: 'Light',
    refresh: 'Refresh list',
    checkUpdates: 'Check for updates',
    checking: 'Checking…',
    cleanup: 'Clean up…',
    import: 'Import from folder…',
    openFolder: 'Open folder',
    install: 'Install',
    installing: 'Installing…',
    updating: 'Updating…',
    removing: 'Removing…',
    use: 'Use',
    current: 'Current',
    update: 'Update to',
    remove: 'Remove',
    github: 'GitHub',
    builtIn: 'Built-in',
    external: 'External folder',
    inUse: 'In use',
    by: 'by',
    loading: 'Loading the community theme list…',
    loadFailed: 'Could not load the community theme list',
    cached: 'showing the cached list',
    retry: 'Retry',
    empty: 'No themes match.',
    noShot: 'No preview',
    count: (n: number) => `${n} theme${n === 1 ? '' : 's'}`,
    library: (size: string) => `Library ${size}`,
    source: 'Themes come from the official Obsidian community list (obsidianmd/obsidian-releases) and are downloaded from their GitHub repositories.',
    more: 'Show more',
  },
  zh: {
    title: '主题',
    installed: '已安装',
    community: '社区主题',
    search: '搜索主题或作者',
    all: '全部模式',
    dark: '深色',
    light: '浅色',
    refresh: '刷新列表',
    checkUpdates: '检查更新',
    checking: '检查中…',
    cleanup: '清理…',
    import: '从文件夹导入…',
    openFolder: '打开主题目录',
    install: '下载安装',
    installing: '下载中…',
    updating: '更新中…',
    removing: '删除中…',
    use: '使用',
    current: '当前',
    update: '更新到',
    remove: '删除',
    github: 'GitHub',
    builtIn: '内置',
    external: '外部目录',
    inUse: '使用中',
    by: '作者',
    loading: '正在加载社区主题列表…',
    loadFailed: '无法加载社区主题列表',
    cached: '显示的是缓存列表',
    retry: '重试',
    empty: '没有匹配的主题。',
    noShot: '无预览图',
    count: (n: number) => `${n} 个主题`,
    library: (size: string) => `主题库 ${size}`,
    source: '主题来自 Obsidian 官方社区主题列表（obsidianmd/obsidian-releases），从各主题的 GitHub 仓库下载。',
    more: '显示更多',
  },
};

const PAGE = 48;
let state: GalleryState | null = null;
const ui: UiState = { tab: 'installed', query: '', mode: 'all', ...((vscode.getState() as Partial<UiState>) ?? {}) };
let limit = PAGE;
const app = document.getElementById('app')!;

function s() {
  return STR[state?.lang ?? 'en'];
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string | null | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function button(label: string, cls: string, onClick: () => void, opts: { disabled?: boolean; aria?: string } = {}) {
  const b = h('button', { type: 'button', class: cls }, label);
  if (opts.disabled) b.disabled = true;
  if (opts.aria) b.setAttribute('aria-label', opts.aria);
  b.addEventListener('click', onClick);
  return b;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function saveUi() {
  vscode.setState(ui);
}

// ---- filtering -------------------------------------------------------------------------

function visibleThemes(): GalleryTheme[] {
  if (!state) return [];
  const q = ui.query.trim().toLowerCase();
  return state.themes.filter((th) => {
    if (ui.tab === 'installed' ? !th.installed : !th.community) return false;
    if (ui.mode !== 'all' && !th.modes.includes(ui.mode)) return false;
    if (q && !th.name.toLowerCase().includes(q) && !th.author.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---- rendering -------------------------------------------------------------------------

function renderHeader(): HTMLElement {
  const st = s();
  const installedCount = state?.themes.filter((x) => x.installed).length ?? 0;
  const tab = (id: Tab, label: string, count: number) => {
    const b = button(`${label} (${count})`, 'tab' + (ui.tab === id ? ' is-active' : ''), () => {
      ui.tab = id;
      limit = PAGE;
      saveUi();
      render();
    });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(ui.tab === id));
    return b;
  };
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tab('installed', st.installed, installedCount), tab('community', st.community, state?.catalog.count ?? 0));

  const search = h('input', { type: 'search', class: 'search', placeholder: st.search, 'aria-label': st.search, value: ui.query });
  search.addEventListener('input', () => {
    ui.query = search.value;
    limit = PAGE;
    saveUi();
    renderGrid();
  });
  const mode = h('select', { class: 'select', 'aria-label': st.all });
  for (const [v, label] of [
    ['all', st.all],
    ['dark', st.dark],
    ['light', st.light],
  ] as const) {
    const o = h('option', { value: v }, label);
    if (ui.mode === v) o.selected = true;
    mode.append(o);
  }
  mode.addEventListener('change', () => {
    ui.mode = mode.value as ModeFilter;
    limit = PAGE;
    saveUi();
    renderGrid();
  });

  const actions = h('div', { class: 'actions' });
  if (ui.tab === 'installed') {
    actions.append(
      button(state?.checkingUpdates ? st.checking : st.checkUpdates, 'secondary', () => post({ type: 'checkUpdates' }), { disabled: !!state?.checkingUpdates }),
      button(st.import, 'secondary', () => post({ type: 'import' })),
      button(st.cleanup, 'secondary', () => post({ type: 'cleanup' })),
      button(st.openFolder, 'secondary', () => post({ type: 'openFolder' })),
    );
  } else {
    actions.append(button(st.refresh, 'secondary', () => post({ type: 'refresh' }), { disabled: !!state?.catalog.loading }));
  }
  return h('header', { class: 'header' }, h('div', { class: 'row' }, h('h1', {}, `iMark · ${st.title}`), tabs), h('div', { class: 'row toolbar' }, search, mode, actions));
}

function renderStatus(): HTMLElement | null {
  if (!state) return null;
  const st = s();
  if (ui.tab === 'installed') return h('p', { class: 'status' }, st.library(formatBytes(state.libraryBytes)), ' · ', h('code', {}, state.libraryDir));
  if (state.catalog.loading && !state.catalog.count) return h('p', { class: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), st.loading);
  if (state.catalog.error) {
    return h(
      'p',
      { class: 'status is-error', role: 'alert' },
      `${st.loadFailed}: ${state.catalog.error}${state.catalog.count ? ` (${st.cached})` : ''} `,
      button(st.retry, 'link', () => post({ type: 'refresh' })),
    );
  }
  return h('p', { class: 'status' }, st.source);
}

function badge(text: string, cls = '') {
  return h('span', { class: `badge ${cls}` }, text);
}

function card(th: GalleryTheme): HTMLElement {
  const st = s();
  const busy = state?.busy[th.name];
  const shot = h('div', { class: 'shot' });
  if (th.screenshot) {
    const img = h('img', { src: th.screenshot, alt: `${th.name} screenshot`, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => {
      img.remove();
      shot.append(h('span', { class: 'placeholder' }, st.noShot));
    });
    shot.append(img);
  } else {
    shot.append(h('span', { class: 'placeholder initial' }, th.name.slice(0, 1).toUpperCase()));
  }

  const badges = h('div', { class: 'badges' });
  if (th.current) badges.append(badge(st.current, 'is-current'));
  else if (th.inUse) badges.append(badge(st.inUse));
  if (th.origin === 'bundled' || th.origin === 'special') badges.append(badge(st.builtIn));
  if (th.origin === 'external') badges.append(badge(st.external));
  for (const m of th.modes) badges.append(badge(m === 'dark' ? st.dark : st.light, 'is-mode'));

  const meta = [th.author ? `${st.by} ${th.author}` : '', th.version ? `v${th.version}` : '', th.size ? formatBytes(th.size) : ''].filter(Boolean).join(' · ');

  const actions = h('div', { class: 'card-actions' });
  if (busy) {
    actions.append(h('span', { class: 'busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), st[busy as 'installing' | 'updating' | 'removing'] ?? busy));
  } else {
    if (!th.installed) actions.append(button(st.install, 'primary', () => post({ type: 'install', name: th.name }), { aria: `${st.install} ${th.name}` }));
    else if (th.current) actions.append(button(`✓ ${st.current}`, 'primary', () => undefined, { disabled: true }));
    else if (th.id) actions.append(button(st.use, 'primary', () => post({ type: 'use', id: th.id! }), { aria: `${st.use} ${th.name}` }));
    if (th.update) actions.append(button(`${st.update} ${th.update}`, 'secondary', () => post({ type: 'update', name: th.name })));
    if (th.installed && th.origin === 'library' && th.id) actions.append(button(st.remove, 'secondary danger', () => post({ type: 'remove', id: th.id! }), { aria: `${st.remove} ${th.name}` }));
    if (th.repo) actions.append(button(st.github, 'link', () => post({ type: 'openUrl', url: `https://github.com/${th.repo}` }), { aria: `${th.name} on GitHub` }));
  }

  return h(
    'article',
    { class: 'card' + (th.current ? ' is-current' : ''), 'aria-label': th.name },
    shot,
    h('div', { class: 'card-body' }, h('h2', { class: 'card-title', title: th.name }, th.name), meta ? h('p', { class: 'meta' }, meta) : null, th.description ? h('p', { class: 'meta' }, th.description) : null, badges, actions),
  );
}

let gridEl: HTMLElement | null = null;
let observer: IntersectionObserver | null = null;

function renderGrid() {
  if (!gridEl) return;
  const list = visibleThemes();
  const st = s();
  observer?.disconnect();
  gridEl.replaceChildren();
  if (!list.length) {
    if (state && !(ui.tab === 'community' && state.catalog.loading)) gridEl.append(h('p', { class: 'empty' }, st.empty));
    return;
  }
  const grid = h('div', { class: 'grid' });
  for (const th of list.slice(0, limit)) grid.append(card(th));
  gridEl.append(h('p', { class: 'count' }, st.count(list.length)), grid);
  if (list.length > limit) {
    const more = button(st.more, 'secondary more', () => {
      limit += PAGE;
      renderGrid();
    });
    gridEl.append(more);
    observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        limit += PAGE;
        renderGrid();
      }
    });
    observer.observe(more);
  }
}

function render() {
  const scroll = document.scrollingElement?.scrollTop ?? 0;
  const focusedSearch = document.activeElement?.classList.contains('search');
  gridEl = h('main', { class: 'content' });
  app.replaceChildren(renderHeader(), renderStatus() ?? '', gridEl);
  renderGrid();
  if (focusedSearch) {
    const input = app.querySelector<HTMLInputElement>('.search');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
}

window.addEventListener('message', (ev: MessageEvent<HostToGallery>) => {
  const m = ev.data;
  if (m.type === 'state') {
    state = m.state;
    render();
  } else if (m.type === 'tab') {
    ui.tab = m.tab;
    saveUi();
    render();
  }
});

render();
post({ type: 'ready' });
