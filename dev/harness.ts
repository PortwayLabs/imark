// Browser harness: mocks the VS Code webview API so the editor can be
// developed and visually tested without VS Code.
import type { HostMessage, InitMessage, WebviewMessage, EditorConfig, ThemeInfo, EditorMode } from '../src/shared/protocol';
import { applyChanges } from '../src/shared/protocol';

declare global {
  interface Window {
    __imark: {
      shadow: string;
      gen: number;
      log: WebviewMessage[];
      send(msg: HostMessage): void;
      setTheme(name: string | null, mode?: 'light' | 'dark' | 'auto'): void;
      setMode(mode: EditorMode): void;
      external(text: string): void;
      ready: Promise<void>;
    };
  }
}

const params = new URLSearchParams(location.search);
const state: Record<string, unknown> = {};
let gen = 1;
let shadow = '';
const log: WebviewMessage[] = [];
let resolveReady: () => void = () => {};
const ready = new Promise<void>((r) => (resolveReady = r));

const files = [
  { root: 0, path: 'dev/sample.md' },
  { root: 0, path: 'dev/Another Note.md' },
  { root: 0, path: 'dev/notes/Deep Note.md' },
  { root: 0, path: 'media/icons/imark.png' },
];

const noteContents: Record<string, string> = {
  'Another Note': '# Another Note\n\nThis note is **embedded** from `dev/Another Note.md`.\n\n- [x] embedded task\n- item two\n',
  'Deep Note': '## Deep Note\n\nA note inside a folder, with a [[sample]] link back.\n',
};

const config: EditorConfig = {
  mode: (params.get('mode') as EditorMode) || 'live',
  readableLineWidth: params.get('wide') ? false : true,
  showInlineTitle: true,
  showHeader: true,
  fontSize: 0,
  lineNumbers: params.get('lines') === '1',
  spellcheck: false,
  autoPairMarkdown: true,
  smartClickLinks: true,
  wideTables: params.get('wide-tables') === '1',
  tabSize: 4,
  insertSpaces: true,
  attachmentLinkStyle: 'markdown',
  platform: 'mac',
};

const BUNDLED = ['Monokai Syntax'];

function themeInfo(name: string | null, mode: 'light' | 'dark' | 'auto' = 'auto'): ThemeInfo {
  if (!name) name = BUNDLED[0];
  if (BUNDLED.includes(name)) return { name, kind: 'theme', cssUris: [`/media/themes/${encodeURIComponent(name)}/theme.css`], mode, extraCss: '' };
  if (name === 'vscode') return { name: 'Follow VS Code', kind: 'vscode', cssUris: ['/media/css/vscode-bridge.css', '/dev/vscode-vars.css'], mode, extraCss: '' };
  if (name === 'obsidian') return { name: 'Obsidian', kind: 'obsidian', cssUris: [], mode, extraCss: '' };
  return { name, kind: 'theme', cssUris: [`/themes/${encodeURIComponent(name)}/theme.css`], mode, extraCss: '' };
}

function send(msg: HostMessage) {
  window.postMessage(msg, '*');
}

async function init() {
  const res = await fetch('/dev/sample.md');
  shadow = await res.text();
  const theme = params.get('theme');
  const mode = (params.get('dark') === '0' ? 'light' : params.get('dark') === '1' ? 'dark' : 'auto') as 'light' | 'dark' | 'auto';
  const init: InitMessage = {
    type: 'init',
    text: shadow,
    gen,
    doc: { fsPath: '/repo/dev/sample.md', title: 'sample', root: 0, path: 'dev/sample.md' },
    roots: [{ fsPath: '/repo', webviewUri: location.origin }],
    files,
    config,
    theme: themeInfo(theme, mode),
  };
  send(init);
  buildDevBar(theme);
  resolveReady();
}

function handle(msg: WebviewMessage) {
  log.push(msg);
  switch (msg.type) {
    case 'ready':
      void init();
      break;
    case 'edit':
      if (msg.gen === gen) shadow = applyChanges(shadow, msg.changes.slice().sort((a, b) => a.from - b.from));
      break;
    case 'readFile': {
      const key = msg.target.replace(/^.*\//, '').replace(/\.md$/, '');
      setTimeout(() => send({ type: 'fileContent', id: msg.id, text: noteContents[key] ?? null }), 50);
      break;
    }
    case 'saveAttachment':
      setTimeout(() => send({ type: 'attachmentSaved', id: msg.id, relPath: `assets/${msg.name || 'Pasted image.png'}`, name: msg.name || 'Pasted image.png' }), 100);
      break;
    case 'stats': {
      const el = document.querySelector('#imark-devbar .stats');
      if (el) el.textContent = `${msg.words}w ${msg.characters}c`;
      break;
    }
    case 'openLink':
    case 'openWikilink':
    case 'searchTag':
    case 'command':
      console.log('[harness]', msg);
      break;
  }
}

(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (m: WebviewMessage) => handle(m),
  getState: () => state.value,
  setState: (v: unknown) => (state.value = v),
});

function buildDevBar(current: string | null) {
  const bar = document.createElement('div');
  bar.id = 'imark-devbar';
  const sel = document.createElement('select');
  const opt = (v: string, label = v) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  };
  for (const b of BUNDLED) opt(b, `${b} (built-in)`);
  opt('vscode', 'Follow VS Code');
  opt('obsidian', 'Obsidian default');
  fetch('/themes/index.json')
    .then((r) => r.json())
    .then((names: string[]) => {
      for (const n of names) opt(n);
      sel.value = current ?? BUNDLED[0];
    });
  sel.addEventListener('change', () => {
    params.set('theme', sel.value);
    history.replaceState(null, '', `?${params}`);
    send({ type: 'theme', theme: themeInfo(sel.value) });
  });
  const dark = document.createElement('button');
  dark.textContent = 'light/dark';
  dark.addEventListener('click', () => {
    document.body.classList.toggle('vscode-dark');
    document.body.classList.toggle('vscode-light');
  });
  const modeSel = document.createElement('select');
  for (const m of ['live', 'source', 'reading']) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    modeSel.appendChild(o);
  }
  modeSel.value = config.mode;
  modeSel.addEventListener('change', () => send({ type: 'setMode', mode: modeSel.value as EditorMode }));
  const stats = document.createElement('span');
  stats.className = 'stats';
  bar.append(sel, dark, modeSel, stats);
  document.body.appendChild(bar);
}

window.__imark = {
  get shadow() {
    return shadow;
  },
  get gen() {
    return gen;
  },
  log,
  send,
  setTheme: (name, mode) => send({ type: 'theme', theme: themeInfo(name, mode) }),
  setMode: (mode) => send({ type: 'setMode', mode }),
  external: (text) => {
    shadow = text;
    gen++;
    send({ type: 'update', text, gen });
  },
  ready,
};
