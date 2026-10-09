// Obsidian community theme catalog: the official list that Obsidian itself (and
// community.obsidian.md) is built from, plus download / install / update of a
// theme into iMark's library. Pure Node (fetch is injected) so it can be unit tested.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import * as tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { sanitizeId } from './themeImport';

export const CATALOG_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json';
/** File written next to an installed theme's theme.css describing where it came from. */
export const INSTALL_INFO = '.imark-theme.json';
const MAX_CSS_BYTES = 20 * 1024 * 1024;

export type FetchFn = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface CatalogEntry {
  name: string;
  author: string;
  /** GitHub `owner/repo`. */
  repo: string;
  /** Screenshot path inside the repository. */
  screenshot: string;
  modes: Array<'dark' | 'light'>;
  /** Pre-1.0 theme that ships `obsidian.css` instead of `theme.css`. */
  legacy: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** Epoch ms of the download the entries come from. */
  fetchedAt: number;
  fromCache: boolean;
  /** Set when a refresh failed and cached data (possibly none) is returned. */
  error?: string;
}

export interface InstallInfo {
  source: 'community';
  repo: string;
  name: string;
  version: string;
  installedAt: number;
  /** Where theme.css was downloaded from. */
  from: 'release' | 'branch' | 'legacy';
}

export interface Downloaded {
  css: string;
  manifest: { name?: string; author?: string; version?: string; [k: string]: unknown };
  version: string;
  from: InstallInfo['from'];
}

/** HTTPS agent that tunnels every connection through an HTTP proxy (CONNECT). */
class TunnelAgent extends https.Agent {
  constructor(private readonly proxy: URL) {
    super({ keepAlive: false });
  }
  createConnection(options: http.ClientRequestArgs & tls.ConnectionOptions, callback?: (err: Error | null, stream: Duplex) => void): undefined {
    const cb = (err: Error | null, socket?: Duplex) => callback?.(err, socket as Duplex);
    const host = options.servername || options.hostname || options.host || 'localhost';
    const auth = this.proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`).toString('base64')}` } : undefined;
    const connect = http.request({ host: this.proxy.hostname, port: Number(this.proxy.port || 80), method: 'CONNECT', path: `${host}:${options.port || 443}`, headers: auth });
    connect.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`proxy CONNECT failed (${res.statusCode})`));
      }
      cb(null, tls.connect({ ...(options as tls.ConnectionOptions), socket, servername: host }));
    });
    connect.once('error', (e) => cb(e));
    connect.end();
    return undefined;
  }
}

/**
 * `fetch`-like GET built on the `https` module. Inside VS Code the extension host
 * patches `https` with the user's proxy configuration (`http.proxy`, environment
 * variables, system proxy), which the global `fetch` does not get on every VS Code
 * version. `proxy` (an `http://host:port` URL) tunnels through a proxy explicitly,
 * for use outside VS Code (tests, scripts). Follows up to 5 redirects.
 */
export function createFetch(opts: { proxy?: string } = {}): FetchFn {
  const proxy = opts.proxy ? new URL(opts.proxy) : null;
  const agent = proxy ? new TunnelAgent(proxy) : null;
  const request = (url: URL, headers: Record<string, string>, signal: AbortSignal | undefined, redirects: number): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      if (url.protocol !== 'https:') return reject(new Error(`refusing non-HTTPS URL ${url.href}`));
      const options: https.RequestOptions = { method: 'GET', headers: { 'accept-encoding': 'identity', ...headers } };
      if (agent) options.agent = agent;
      const req = https.request(url, options, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new Error(`too many redirects for ${url.href}`));
          request(new URL(res.headers.location, url), headers, signal, redirects - 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_CSS_BYTES) req.destroy(new Error(`response too large: ${url.href}`));
          else chunks.push(c);
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('error', reject);
      signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
      req.end();
    });
  return async (url, init) => {
    const { status, body } = await request(new URL(url), init?.headers ?? {}, init?.signal, 5);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Validate the raw catalog JSON; malformed entries are skipped. */
export function parseCatalog(json: unknown): CatalogEntry[] {
  if (!Array.isArray(json)) throw new Error('unexpected catalog format');
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of json as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
    if (!name || !REPO_RE.test(repo) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const modes = Array.isArray(raw.modes) ? (raw.modes.filter((m) => m === 'dark' || m === 'light') as CatalogEntry['modes']) : [];
    out.push({
      name,
      author: typeof raw.author === 'string' ? raw.author : '',
      repo,
      screenshot: typeof raw.screenshot === 'string' ? raw.screenshot : '',
      modes: modes.length ? modes : ['dark', 'light'],
      legacy: raw.legacy === true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

const raw = (repo: string, file: string) => `https://raw.githubusercontent.com/${repo}/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`;

export function screenshotUrl(e: CatalogEntry): string {
  return e.screenshot ? raw(e.repo, e.screenshot) : '';
}

export function repoUrl(e: CatalogEntry): string {
  return `https://github.com/${e.repo}`;
}

/** Folder name / theme id of an installed catalog theme (Obsidian uses the theme name too). */
export function themeIdFor(e: CatalogEntry): string {
  return sanitizeId(e.name);
}

async function get(fetchFn: FetchFn, url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { 'user-agent': 'iMark (VS Code extension)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`timed out fetching ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Load the catalog, using `cacheFile` when it is fresher than `maxAgeMs` or the network fails. */
export async function loadCatalog(
  cacheFile: string,
  fetchFn: FetchFn,
  opts: { maxAgeMs?: number; force?: boolean; now?: number } = {},
): Promise<Catalog> {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? 12 * 60 * 60 * 1000;
  let cached: { fetchedAt: number; entries: CatalogEntry[] } | null = null;
  try {
    const data = JSON.parse(await fsp.readFile(cacheFile, 'utf8')) as { fetchedAt: number; entries: unknown };
    cached = { fetchedAt: data.fetchedAt, entries: parseCatalog(data.entries) };
  } catch {
    cached = null;
  }
  if (cached && !opts.force && now - cached.fetchedAt < maxAge) return { ...cached, fromCache: true };
  try {
    const entries = parseCatalog(JSON.parse(await get(fetchFn, CATALOG_URL, 20000)));
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify({ fetchedAt: now, entries }));
    return { entries, fetchedAt: now, fromCache: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return cached ? { ...cached, fromCache: true, error } : { entries: [], fetchedAt: 0, fromCache: true, error };
  }
}

function looksLikeCss(text: string): boolean {
  const head = text.slice(0, 512).trimStart().toLowerCase();
  if (!head || head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('{"')) return false;
  return text.length <= MAX_CSS_BYTES;
}

/** Latest version from the repository's manifest.json (null when there is none). */
export async function fetchManifest(e: CatalogEntry, fetchFn: FetchFn): Promise<Downloaded['manifest'] | null> {
  try {
    const m = JSON.parse(await get(fetchFn, raw(e.repo, 'manifest.json'), 15000)) as Downloaded['manifest'];
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

/**
 * Download a theme the way Obsidian does: the release asset of the manifest's
 * version first, then theme.css from the default branch, then the legacy
 * obsidian.css.
 */
export async function downloadTheme(e: CatalogEntry, fetchFn: FetchFn): Promise<Downloaded> {
  const manifest = (await fetchManifest(e, fetchFn)) ?? {};
  const version = typeof manifest.version === 'string' ? manifest.version : '';
  const attempts: Array<[string, InstallInfo['from']]> = [];
  if (version) attempts.push([`https://github.com/${e.repo}/releases/download/${encodeURIComponent(version)}/theme.css`, 'release']);
  attempts.push([raw(e.repo, 'theme.css'), 'branch']);
  attempts.push([raw(e.repo, 'obsidian.css'), 'legacy']);
  if (e.legacy) attempts.unshift(attempts.pop()!);
  const errors: string[] = [];
  for (const [url, from] of attempts) {
    try {
      const css = await get(fetchFn, url, 60000);
      if (!looksLikeCss(css)) {
        errors.push(`${url}: not a stylesheet`);
        continue;
      }
      return { css, manifest, version: version || '0.0.0', from };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`could not download theme "${e.name}" (${errors.join('; ')})`);
}

/** Write a downloaded theme into `libraryDir/<id>/`; returns the theme folder. */
export async function writeTheme(e: CatalogEntry, d: Downloaded, libraryDir: string, now = Date.now()): Promise<string> {
  const dir = path.join(libraryDir, themeIdFor(e));
  // Stage outside the library so a crash never leaves a half-written theme in the list.
  const tmp = path.join(path.dirname(libraryDir), 'tmp', `${themeIdFor(e)}-${process.pid}-${now}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const manifest = { ...d.manifest, name: e.name, author: (d.manifest.author as string | undefined) || e.author, version: d.version };
  const info: InstallInfo = { source: 'community', repo: e.repo, name: e.name, version: d.version, installedAt: now, from: d.from };
  await fsp.writeFile(path.join(tmp, 'theme.css'), d.css);
  await fsp.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(tmp, INSTALL_INFO), JSON.stringify(info, null, 2));
  await fsp.mkdir(libraryDir, { recursive: true });
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(tmp, dir);
  return dir;
}

export function readInstallInfo(dir: string): InstallInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, INSTALL_INFO), 'utf8')) as InstallInfo;
    return info && info.source === 'community' && typeof info.repo === 'string' ? info : null;
  } catch {
    return null;
  }
}

/** Compare dotted versions numerically (`1.10.0` > `1.9.2`); non-numeric parts compare as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/);
  const pb = b.replace(/^v/i, '').split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Total size in bytes of a folder (recursive). */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else {
      try {
        total += (await fsp.stat(p)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}
