// Pure Node helpers for importing Obsidian themes / snippets / appearance
// settings into iMark's own theme library. No `vscode` dependency so it can be
// unit tested.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface ThemeSource {
  /** Folder containing theme.css. */
  dir: string;
  /** Folder name, used as the theme id. */
  id: string;
  name: string;
  author?: string;
  version?: string;
}

export interface AppearanceConfig {
  cssTheme?: string;
  /** Obsidian base theme: `obsidian` (dark), `moonstone` (light) or `system`. */
  theme?: string;
  accentColor?: string;
  enabledCssSnippets?: string[];
}

export interface ImportPlan {
  themes: ThemeSource[];
  /** CSS snippet files to import. */
  snippets: string[];
  /** Vault appearance settings, when the source is (inside) an Obsidian vault. */
  appearance: AppearanceConfig | null;
  /** Directory the appearance's snippets live in. */
  vaultSnippetsDir: string | null;
}

const exists = (p: string) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

export function readManifest(dir: string): { name?: string; author?: string; version?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function themeSource(dir: string): ThemeSource | null {
  if (!exists(path.join(dir, 'theme.css'))) return null;
  const manifest = readManifest(dir);
  const id = path.basename(dir);
  return { dir, id, name: manifest.name || id, author: manifest.author, version: manifest.version };
}

/** All theme folders directly inside `dir`. */
export function themesIn(dir: string): ThemeSource[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => themeSource(path.join(dir, e.name)))
    .filter((t): t is ThemeSource => !!t)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readAppearance(obsidianDir: string): AppearanceConfig | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(obsidianDir, 'appearance.json'), 'utf8')) as AppearanceConfig;
  } catch {
    return null;
  }
}

/** Walk up from `start` to find a folder containing `.obsidian`. */
export function findVaultDir(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (exists(path.join(dir, '.obsidian'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Work out what a user-picked path contains:
 * - a theme folder (has theme.css) or a theme.css file
 * - a folder of themes (e.g. `.obsidian/themes`)
 * - an `.obsidian` folder or a vault root (imports all themes + appearance)
 * - a loose `.css` file (imported as a snippet)
 */
export function planImport(picked: string): ImportPlan {
  const plan: ImportPlan = { themes: [], snippets: [], appearance: null, vaultSnippetsDir: null };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(picked);
  } catch {
    return plan;
  }
  if (stat.isFile()) {
    if (path.basename(picked).toLowerCase() === 'theme.css') {
      const t = themeSource(path.dirname(picked));
      if (t) plan.themes.push(t);
    } else if (picked.toLowerCase().endsWith('.css')) {
      plan.snippets.push(picked);
    }
    return plan;
  }
  const single = themeSource(picked);
  if (single) {
    plan.themes.push(single);
    return plan;
  }
  let obsidianDir: string | null = null;
  if (path.basename(picked) === '.obsidian') obsidianDir = picked;
  else if (exists(path.join(picked, '.obsidian'))) obsidianDir = path.join(picked, '.obsidian');
  else if (path.basename(picked) === 'themes' && path.basename(path.dirname(picked)) === '.obsidian') obsidianDir = path.dirname(picked);

  const themesDir = obsidianDir ? path.join(obsidianDir, 'themes') : picked;
  plan.themes = themesIn(themesDir);
  if (obsidianDir) {
    plan.appearance = readAppearance(obsidianDir);
    const snippetsDir = path.join(obsidianDir, 'snippets');
    if (exists(snippetsDir)) plan.vaultSnippetsDir = snippetsDir;
    for (const name of plan.appearance?.enabledCssSnippets ?? []) {
      const p = path.join(snippetsDir, `${name}.css`);
      if (exists(p)) plan.snippets.push(p);
    }
  }
  return plan;
}

/** Copy a theme folder (theme.css, manifest.json and any assets) into the library. */
export async function copyTheme(source: ThemeSource, libraryDir: string): Promise<string> {
  const target = path.join(libraryDir, sanitizeId(source.id));
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  await fsp.cp(source.dir, target, {
    recursive: true,
    filter: (src) => !path.basename(src).startsWith('.') && !/node_modules/.test(src),
  });
  if (!exists(path.join(target, 'manifest.json'))) {
    await fsp.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ name: source.name, author: source.author ?? '', version: source.version ?? '0.0.0' }, null, 2));
  }
  return target;
}

export async function copySnippet(file: string, snippetsDir: string): Promise<string> {
  await fsp.mkdir(snippetsDir, { recursive: true });
  const target = path.join(snippetsDir, path.basename(file));
  await fsp.copyFile(file, target);
  return target;
}

export function sanitizeId(id: string): string {
  return id.replace(/[\\/:*?"<>|]/g, '_').trim() || 'theme';
}

/** Map Obsidian's base theme setting to iMark's mode. */
export function appearanceMode(theme: string | undefined): 'auto' | 'light' | 'dark' | null {
  if (theme === 'obsidian') return 'dark';
  if (theme === 'moonstone') return 'light';
  if (theme === 'system') return 'auto';
  return null;
}
