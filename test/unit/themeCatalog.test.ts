import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CATALOG_URL,
  INSTALL_INFO,
  compareVersions,
  downloadTheme,
  loadCatalog,
  parseCatalog,
  readInstallInfo,
  screenshotUrl,
  writeTheme,
  type FetchFn,
} from '../../src/extension/themeCatalog';
import { themeSource } from '../../src/extension/themeImport';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imark-catalog-'));
afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
});

/** Fake fetch serving a URL -> body map (missing URLs are 404). */
function fakeFetch(routes: Record<string, string>, seen: string[] = []): FetchFn {
  return async (url) => {
    seen.push(url);
    const body = routes[url];
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, text: async () => body ?? 'Not Found' };
  };
}

const minimal = { name: 'Minimal', author: 'kepano', repo: 'kepano/obsidian-minimal', screenshot: 'dark simple.png', modes: ['dark', 'light'] };
const legacy = { name: 'Amethyst', author: 'cotemaxime', repo: 'cotemaxime/obsidian-amethyst', screenshot: 'screenshot.png', modes: ['dark'], legacy: true };
const RAW = 'https://raw.githubusercontent.com';

describe('community theme catalog', () => {
  it('parses and validates the catalog JSON', () => {
    const list = parseCatalog([minimal, legacy, { name: 'bad repo', repo: 'nope' }, { name: 'minimal', repo: 'x/y' }, null, { name: 'No modes', repo: 'a/b' }]);
    expect(list.map((e) => e.name)).toEqual(['Amethyst', 'Minimal', 'No modes']);
    expect(list[0].legacy).toBe(true);
    expect(list[2].modes).toEqual(['dark', 'light']);
    expect(screenshotUrl(list[1])).toBe(`${RAW}/kepano/obsidian-minimal/HEAD/dark%20simple.png`);
    expect(() => parseCatalog({})).toThrow();
  });

  it('caches the catalog and falls back to the cache when offline', async () => {
    const cache = path.join(tmp, 'cache', 'themes.json');
    const online = fakeFetch({ [CATALOG_URL]: JSON.stringify([minimal]) });
    const first = await loadCatalog(cache, online, { now: 1000 });
    expect(first.fromCache).toBe(false);
    expect(first.entries).toHaveLength(1);
    const offline = fakeFetch({});
    const fresh = await loadCatalog(cache, offline, { now: 2000 });
    expect(fresh.fromCache).toBe(true);
    expect(fresh.error).toBeUndefined();
    const stale = await loadCatalog(cache, offline, { now: 1000 + 13 * 3600 * 1000 });
    expect(stale.entries).toHaveLength(1);
    expect(stale.error).toMatch(/404/);
    const none = await loadCatalog(path.join(tmp, 'missing.json'), offline);
    expect(none.entries).toEqual([]);
    expect(none.error).toBeTruthy();
  });

  it('downloads the release asset of the manifest version first', async () => {
    const [entry] = parseCatalog([minimal]);
    const seen: string[] = [];
    const fetchFn = fakeFetch(
      {
        [`${RAW}/kepano/obsidian-minimal/HEAD/manifest.json`]: JSON.stringify({ name: 'Minimal', version: '8.0.1', author: '@kepano' }),
        'https://github.com/kepano/obsidian-minimal/releases/download/8.0.1/theme.css': 'body{--x:1}',
        [`${RAW}/kepano/obsidian-minimal/HEAD/theme.css`]: 'body{--branch:1}',
      },
      seen,
    );
    const d = await downloadTheme(entry, fetchFn);
    expect(d.from).toBe('release');
    expect(d.version).toBe('8.0.1');
    expect(d.css).toBe('body{--x:1}');

    const dir = await writeTheme(entry, d, path.join(tmp, 'themes'), 42);
    expect(path.basename(dir)).toBe('Minimal');
    expect(fs.readFileSync(path.join(dir, 'theme.css'), 'utf8')).toBe('body{--x:1}');
    expect(themeSource(dir)).toMatchObject({ id: 'Minimal', name: 'Minimal', version: '8.0.1', author: '@kepano' });
    expect(readInstallInfo(dir)).toMatchObject({ repo: 'kepano/obsidian-minimal', version: '8.0.1', installedAt: 42, from: 'release' });
    expect(fs.existsSync(path.join(dir, INSTALL_INFO))).toBe(true);
    // staging folder is cleaned up and never listed inside the library
    expect(fs.readdirSync(path.join(tmp, 'themes'))).toEqual(['Minimal']);
  });

  it('falls back to the default branch and to legacy obsidian.css; rejects non-CSS', async () => {
    const [amethyst, mini] = parseCatalog([legacy, minimal]);
    const branch = await downloadTheme(mini, fakeFetch({ [`${RAW}/kepano/obsidian-minimal/HEAD/theme.css`]: '.x{}' }));
    expect(branch.from).toBe('branch');
    expect(branch.version).toBe('0.0.0');
    const old = await downloadTheme(amethyst, fakeFetch({ [`${RAW}/cotemaxime/obsidian-amethyst/HEAD/obsidian.css`]: '.y{}' }));
    expect(old.from).toBe('legacy');
    await expect(downloadTheme(mini, fakeFetch({ [`${RAW}/kepano/obsidian-minimal/HEAD/theme.css`]: '<!DOCTYPE html><html>' }))).rejects.toThrow(/not a stylesheet/);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('v2.0', '2.0.0')).toBe(0);
    expect(compareVersions('0.0.0', '7.3.1')).toBe(-1);
  });
});
