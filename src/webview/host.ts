// Thin wrapper around the VS Code webview API with typed messaging and
// request/response helpers. Falls back to a no-op host in the dev harness.
import type { HostMessage, WebviewMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

type Listener = (msg: HostMessage) => void;

class Host {
  private api: VsCodeApi | null = null;
  private listeners = new Set<Listener>();
  private nextId = 1;
  private pending = new Map<number, (msg: HostMessage) => void>();

  constructor() {
    try {
      this.api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    } catch {
      this.api = null;
    }
    window.addEventListener('message', (ev) => {
      const msg = ev.data as HostMessage;
      if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
      const id = (msg as { id?: number }).id;
      if (typeof id === 'number' && this.pending.has(id)) {
        const cb = this.pending.get(id)!;
        this.pending.delete(id);
        cb(msg);
        return;
      }
      for (const l of this.listeners) l(msg);
    });
  }

  post(msg: WebviewMessage): void {
    this.api?.postMessage(msg);
  }

  /** Send a message carrying an `id` and resolve with the reply that echoes it. */
  request<T extends HostMessage>(build: (id: number) => WebviewMessage, timeoutMs = 15000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('host request timed out'));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg as T);
      });
      this.post(build(id));
    });
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState<T>(): T | undefined {
    return (this.api?.getState() as T | undefined) ?? undefined;
  }

  setState(state: unknown): void {
    this.api?.setState(state);
  }
}

export const host = new Host();
