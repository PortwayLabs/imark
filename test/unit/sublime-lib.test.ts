import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper module without types
import { packageFileName, packageMetadata, parseBuildArgs, shouldPackage, sublimePackagesDir } from '../../scripts/sublime-lib.mjs';

describe('sublimePackagesDir', () => {
  it('honours SUBLIME_PACKAGES and picks per-platform defaults', () => {
    expect(sublimePackagesDir({ platform: 'linux', env: { SUBLIME_PACKAGES: '/x' }, home: '/home/u' })).toBe('/x');
    expect(sublimePackagesDir({ platform: 'darwin', env: {}, home: '/Users/u' })).toBe('/Users/u/Library/Application Support/Sublime Text/Packages');
    expect(sublimePackagesDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home: 'C:\\Users\\u' })).toMatch(/Sublime Text[\\/]Packages$/);
    expect(sublimePackagesDir({ platform: 'linux', env: {}, home: '/home/u', exists: (p: string) => p.includes('sublime-text-3') })).toBe('/home/u/.config/sublime-text-3/Packages');
    expect(sublimePackagesDir({ platform: 'linux', env: {}, home: '/home/u' })).toBe('/home/u/.config/sublime-text/Packages');
  });
});

describe('shouldPackage', () => {
  it('excludes build noise and tests', () => {
    expect(shouldPackage('imark.py')).toBe(true);
    expect(shouldPackage('imark_lib/server.py')).toBe(true);
    expect(shouldPackage('web/webview/main.js')).toBe(true);
    expect(shouldPackage('web/webview/main.js.map')).toBe(false);
    expect(shouldPackage('imark_lib/__pycache__/server.cpython-38.pyc')).toBe(false);
    expect(shouldPackage('.DS_Store')).toBe(false);
    expect(shouldPackage('tests/test_sync.py')).toBe(false);
  });
});

describe('packageMetadata / parseBuildArgs / packageFileName', () => {
  it('builds metadata from package.json', () => {
    const m = packageMetadata({ version: '1.2.3', repository: { url: 'https://example.com/r.git' } }, new Date('2026-09-08T00:00:00Z'));
    expect(m).toMatchObject({ name: 'iMark', version: '1.2.3', repository: 'https://example.com/r.git', python: '3.8', built: '2026-09-08T00:00:00.000Z' });
    expect(packageFileName('1.2.3')).toBe('iMark-1.2.3.sublime-package');
  });
  it('parses options', () => {
    expect(parseBuildArgs([])).toMatchObject({ out: 'release', zip: true, link: false, install: false, uninstall: false });
    expect(parseBuildArgs(['--no-zip', '--link', '--out', 'x', '--packages-dir', '/p'])).toMatchObject({ zip: false, link: true, out: 'x', packagesDir: '/p' });
    expect(() => parseBuildArgs(['--link', '--install'])).toThrow(/mutually exclusive/);
    expect(() => parseBuildArgs(['--nope'])).toThrow(/Unknown option/);
  });
});
