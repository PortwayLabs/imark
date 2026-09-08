import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appearanceMode, copySnippet, copyTheme, planImport, themesIn } from '../../src/extension/themeImport';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'imark-themes-'));
  const vault = path.join(root, 'vault');
  const mk = (p: string, content = '') => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  mk(path.join(vault, '.obsidian', 'themes', 'Alpha', 'theme.css'), 'body{--x:1}');
  mk(path.join(vault, '.obsidian', 'themes', 'Alpha', 'manifest.json'), JSON.stringify({ name: 'Alpha Theme', author: 'a', version: '1.0.0' }));
  mk(path.join(vault, '.obsidian', 'themes', 'Beta', 'theme.css'), 'body{--y:2}');
  mk(path.join(vault, '.obsidian', 'themes', 'NotATheme', 'readme.md'), 'x');
  mk(path.join(vault, '.obsidian', 'snippets', 'tweaks.css'), '.x{}');
  mk(path.join(vault, '.obsidian', 'appearance.json'), JSON.stringify({ cssTheme: 'Alpha Theme', theme: 'obsidian', accentColor: '#ff0000', enabledCssSnippets: ['tweaks'] }));
  mk(path.join(root, 'loose.css'), '.loose{}');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('planImport', () => {
  it('imports a single theme folder or its theme.css', () => {
    const dir = path.join(root, 'vault', '.obsidian', 'themes', 'Alpha');
    expect(planImport(dir).themes.map((t) => t.name)).toEqual(['Alpha Theme']);
    expect(planImport(path.join(dir, 'theme.css')).themes.map((t) => t.id)).toEqual(['Alpha']);
  });
  it('imports every theme from a themes folder', () => {
    const themes = planImport(path.join(root, 'vault', '.obsidian', 'themes')).themes;
    expect(themes.map((t) => t.id).sort()).toEqual(['Alpha', 'Beta']);
  });
  it('imports themes, appearance and enabled snippets from a vault root or .obsidian', () => {
    for (const p of [path.join(root, 'vault'), path.join(root, 'vault', '.obsidian')]) {
      const plan = planImport(p);
      expect(plan.themes.length).toBe(2);
      expect(plan.appearance?.cssTheme).toBe('Alpha Theme');
      expect(plan.appearance?.accentColor).toBe('#ff0000');
      expect(plan.snippets.map((s) => path.basename(s))).toEqual(['tweaks.css']);
    }
  });
  it('treats a loose css file as a snippet', () => {
    const plan = planImport(path.join(root, 'loose.css'));
    expect(plan.themes).toEqual([]);
    expect(plan.snippets.length).toBe(1);
  });
  it('lists themes and maps appearance modes', () => {
    expect(themesIn(path.join(root, 'vault', '.obsidian', 'themes')).map((t) => t.name)).toEqual(['Alpha Theme', 'Beta']);
    expect(appearanceMode('obsidian')).toBe('dark');
    expect(appearanceMode('moonstone')).toBe('light');
    expect(appearanceMode('system')).toBe('auto');
    expect(appearanceMode(undefined)).toBeNull();
  });
});

describe('copyTheme / copySnippet', () => {
  it('copies a theme into the library and keeps its manifest', async () => {
    const lib = path.join(root, 'lib');
    const src = planImport(path.join(root, 'vault', '.obsidian', 'themes', 'Beta')).themes[0];
    const target = await copyTheme(src, lib);
    expect(fs.existsSync(path.join(target, 'theme.css'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    expect(manifest.name).toBe('Beta');
    const snippet = await copySnippet(path.join(root, 'loose.css'), path.join(lib, 'snippets'));
    expect(fs.existsSync(snippet)).toBe(true);
  });
});
