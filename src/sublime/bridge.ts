// Sublime Text bridge: connects the iMark editor bundle to the iMark server
// running inside Sublime Text's plugin host over a WebSocket. It stands in for
// the VS Code webview API (`acquireVsCodeApi` + `window` message events) so the
// editor code is shared unchanged between VS Code and Sublime Text.
//
// Loaded as a classic script before `main.js` (a module), so the shim exists by
// the time the editor's `host` singleton is created.
import type { HostMessage, WebviewMessage } from '../shared/protocol';

/** Messages only the bridge understands (not forwarded to the editor). */
type BridgeInbound =
  | { type: 'hostTheme'; dark: boolean }
  | { type: 'navigate'; url: string }
  | { type: 'closed'; reason?: string }
  | { type: 'toast'; message: string };
type Inbound = HostMessage | BridgeInbound;
type Outbound = WebviewMessage | { type: 'resync' } | { type: 'save' };

const params = new URLSearchParams(location.search);
const token = params.get('t') ?? '';
const file = params.get('file') ?? '';
const sid = decodeURIComponent(location.pathname.replace(/^\/edit\//, '')) || 'default';
const stateKey = `imark:${sid}:state`;
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(sid)}?t=${encodeURIComponent(token)}&file=${encodeURIComponent(file)}`;

let ws: WebSocket | null = null;
let initialized = false; // an `init` message has reached the editor
let everConnected = false;
let closedByHost = false;
let retryDelay = 400;
let retryTimer: number | undefined;
let queue: string[] = [];

// ---- status pill ---------------------------------------------------------------

const style = document.createElement('style');
style.textContent = `
#imark-bridge-status{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:100000;display:none;align-items:center;gap:10px;
  padding:7px 12px;border-radius:999px;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:rgba(32,32,36,.92);
  box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(6px);pointer-events:auto;max-width:80vw}
#imark-bridge-status.show{display:flex}
#imark-bridge-status .dot{width:8px;height:8px;border-radius:50%;background:#f5a623;flex:none}
#imark-bridge-status.ok .dot{background:#3ddc84}
#imark-bridge-status.err .dot{background:#ff5f56}
#imark-bridge-status button{font:inherit;border:0;border-radius:6px;padding:3px 8px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}
#imark-bridge-status button:hover{background:rgba(255,255,255,.26)}`;
document.head.appendChild(style);

const pill = document.createElement('div');
pill.id = 'imark-bridge-status';
const dot = document.createElement('span');
dot.className = 'dot';
const label = document.createElement('span');
const action = document.createElement('button');
action.style.display = 'none';
pill.append(dot, label, action);
let pillTimer: number | undefined;
let pillPending: number | undefined;

function showStatus(text: string, kind: 'wait' | 'ok' | 'err', opts: { autoHide?: number; delay?: number; button?: { label: string; onClick: () => void } } = {}) {
  window.clearTimeout(pillTimer);
  window.clearTimeout(pillPending);
  const apply = () => {
    if (!pill.isConnected) document.body.appendChild(pill);
    label.textContent = text;
    pill.className = `show ${kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''}`;
    if (opts.button) {
      action.textContent = opts.button.label;
      action.onclick = opts.button.onClick;
      action.style.display = '';
    } else action.style.display = 'none';
    if (opts.autoHide) pillTimer = window.setTimeout(hideStatus, opts.autoHide);
  };
  if (opts.delay) pillPending = window.setTimeout(apply, opts.delay);
  else apply();
}

function hideStatus() {
  window.clearTimeout(pillTimer);
  window.clearTimeout(pillPending);
  pill.classList.remove('show');
}

// ---- transport -------------------------------------------------------------------

function send(msg: Outbound) {
  const data = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  else if (!closedByHost) queue.push(data);
}

function deliver(msg: Inbound) {
  switch (msg.type) {
    case 'hostTheme':
      document.body.classList.toggle('imark-prefers-dark', msg.dark);
      document.body.classList.toggle('imark-prefers-light', !msg.dark);
      return;
    case 'navigate':
      closedByHost = true; // do not reconnect this session while navigating away
      location.href = msg.url;
      return;
    case 'closed':
      closedByHost = true;
      showStatus(msg.reason || 'The document was closed in Sublime Text.', 'err', {
        button: {
          label: 'Reopen',
          onClick: () => {
            closedByHost = false;
            hideStatus();
            location.reload();
          },
        },
      });
      return;
    case 'toast':
      showStatus(msg.message, 'ok', { autoHide: 2500 });
      return;
    case 'init':
      initialized = true;
      document.title = `${msg.doc.title} – iMark`;
      break;
    case 'documentInfo':
      document.title = `${msg.doc.title} – iMark`;
      break;
    case 'focus':
      window.focus();
      break;
  }
  window.postMessage(msg, '*');
}

function connect() {
  window.clearTimeout(retryTimer);
  if (closedByHost) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  socket.addEventListener('open', () => {
    if (ws !== socket) return;
    retryDelay = 400;
    // After a reconnect the editor already exists: ask for the current text
    // instead of re-initialising; a fresh page still needs `init`.
    const wasReconnect = everConnected;
    everConnected = true;
    const pending = queue;
    queue = [];
    if (initialized) {
      send({ type: 'resync' });
      if (wasReconnect) showStatus('Reconnected to Sublime Text', 'ok', { autoHide: 1800 });
      else hideStatus();
    } else {
      // Replay the editor's `ready` if it was posted while we were connecting; otherwise the
      // editor (main.js, still loading) will post it once it exists and it goes out directly.
      const ready = pending.find((d) => d.includes('"type":"ready"'));
      if (ready) socket.send(ready);
      hideStatus();
    }
  });
  socket.addEventListener('message', (ev) => {
    if (ws !== socket) return;
    let msg: Inbound;
    try {
      msg = JSON.parse(String(ev.data)) as Inbound;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    deliver(msg);
  });
  socket.addEventListener('close', () => {
    if (ws !== socket) return;
    ws = null;
    if (closedByHost) return;
    showStatus(everConnected ? 'Connection to Sublime Text lost, reconnecting…' : 'Connecting to Sublime Text…', 'wait', { delay: 800 });
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    /* `close` follows */
  });
}

function scheduleReconnect() {
  window.clearTimeout(retryTimer);
  if (closedByHost) return;
  retryTimer = window.setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 1.6, 5000);
}

// ---- VS Code API shim -----------------------------------------------------------------

function readState(): unknown {
  try {
    const raw = sessionStorage.getItem(stateKey);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeState(state: unknown) {
  try {
    sessionStorage.setItem(stateKey, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

(window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (m: WebviewMessage) => send(m),
  getState: () => readState(),
  setState: (v: unknown) => writeState(v),
});

// ---- browser integration ---------------------------------------------------------------

// Cmd/Ctrl+S saves the buffer in Sublime Text instead of showing the browser's "Save page" dialog.
window.addEventListener(
  'keydown',
  (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      send({ type: 'save' });
    }
  },
  true,
);

// Match the OS appearance until the host tells us what Sublime Text uses.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
document.body.classList.add(prefersDark.matches ? 'imark-prefers-dark' : 'imark-prefers-light');
document.body.classList.add('imark-sublime');

connect();

(window as unknown as { __imarkBridge: unknown }).__imarkBridge = {
  get socket() {
    return ws;
  },
  send,
  reconnect: () => {
    closedByHost = false;
    connect();
  },
};
