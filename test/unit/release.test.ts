import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper module without types
import { bumpVersion, extractSection, missingNlsKeys, parseArgs, prepareChangelog } from '../../scripts/release-lib.mjs';

describe('bumpVersion', () => {
  it('bumps patch / minor / major', () => {
    expect(bumpVersion('0.2.1', 'patch')).toBe('0.2.2');
    expect(bumpVersion('0.2.1', 'minor')).toBe('0.3.0');
    expect(bumpVersion('0.2.1', 'major')).toBe('1.0.0');
  });
  it('accepts explicit greater versions and rejects lower ones', () => {
    expect(bumpVersion('0.2.1', '1.0.0-beta.1')).toBe('1.0.0-beta.1');
    expect(bumpVersion('0.2.1', 'v0.3.0')).toBe('0.3.0');
    expect(() => bumpVersion('0.2.1', '0.2.1')).toThrow();
    expect(() => bumpVersion('0.2.1', '0.1.9')).toThrow();
    expect(() => bumpVersion('0.2.1', 'banana')).toThrow();
  });
});

describe('prepareChangelog', () => {
  const en = '# Changelog\n\n## Unreleased\n\n- New thing\n\n## 0.2.1\n\n- Old thing\n';
  it('turns Unreleased into a dated version section', () => {
    const r = prepareChangelog(en, '0.2.2', '2026-09-08');
    expect(r.text).toContain('## 0.2.2 (2026-09-08)');
    expect(r.text).not.toMatch(/Unreleased/);
    expect(r.body).toBe('- New thing');
  });
  it('handles the Chinese heading and existing version headings', () => {
    const zh = '# 更新日志\n\n## 未发布\n\n- 新功能\n';
    expect(prepareChangelog(zh, '1.0.0', '2026-01-01').text).toContain('## 1.0.0 (2026-01-01)');
    const existing = '# Changelog\n\n## 0.2.2\n\n- Prepared entry\n';
    const r = prepareChangelog(existing, '0.2.2', '2026-09-08');
    expect(r.text).toContain('## 0.2.2 (2026-09-08)');
    expect(r.body).toBe('- Prepared entry');
    const dated = '# Changelog\n\n## 0.2.2 (2026-09-01)\n\n- Kept date\n';
    expect(prepareChangelog(dated, '0.2.2', '2026-09-08').text).toContain('(2026-09-01)');
  });
  it('rejects changelogs without a matching or empty section', () => {
    expect(() => prepareChangelog('# Changelog\n\n## 0.2.1\n\n- x\n', '0.2.2')).toThrow(/No "## Unreleased"/);
    expect(() => prepareChangelog('# Changelog\n\n## Unreleased\n\n## 0.2.1\n\n- x\n', '0.2.2')).toThrow(/empty/);
  });
  it('extracts only the requested section', () => {
    expect(extractSection('## 1.0.0\n\n- a\n- b\n\n## 0.9.0\n\n- c\n', '1.0.0')).toBe('- a\n- b');
  });
});

describe('missingNlsKeys / parseArgs', () => {
  it('reports keys absent from a bundle', () => {
    const pkg = { a: '%x.one%', b: { c: '%x.two%' } };
    expect(missingNlsKeys(pkg, { en: { 'x.one': '1', 'x.two': '2' }, zh: { 'x.one': '1' } })).toEqual({ zh: ['x.two'] });
  });
  it('parses options', () => {
    const o = parseArgs(['minor', '--dry-run', '--push', '--out', 'dist/releases', '--skip-sublime']);
    expect(o).toMatchObject({ bump: 'minor', dryRun: true, push: true, out: 'dist/releases', skipSublime: true });
    expect(parseArgs(['patch']).skipSublime).toBe(false);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['patch', 'minor'])).toThrow(/Unexpected/);
  });
});
