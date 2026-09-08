// Pure helpers for the Sublime Text package build (no side effects) so they can be unit tested.
import os from 'node:os';
import path from 'node:path';

/** Sublime Text's Packages directory for the current user. */
export function sublimePackagesDir({ platform = process.platform, env = process.env, home = os.homedir(), exists = () => false } = {}) {
  if (env.SUBLIME_PACKAGES) return env.SUBLIME_PACKAGES;
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Sublime Text', 'Packages');
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Sublime Text', 'Packages');
  const candidates = [path.join(home, '.config', 'sublime-text', 'Packages'), path.join(home, '.config', 'sublime-text-3', 'Packages')];
  return candidates.find((c) => exists(c)) ?? candidates[0];
}

/** Whether a file (path relative to the package root, POSIX separators) belongs in the package. */
export function shouldPackage(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (parts.includes('__pycache__') || parts.includes('tests') || parts.includes('dev')) return false;
  if (base === '.DS_Store' || base.endsWith('.pyc') || base.endsWith('.map')) return false;
  return true;
}

/** Metadata written to imark-package.json inside the package. */
export function packageMetadata(pkg, date = new Date()) {
  return {
    name: 'iMark',
    version: pkg.version,
    description: 'Typora / Obsidian style live-preview Markdown editor for Sublime Text (loads Obsidian themes unchanged).',
    built: date.toISOString(),
    repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '',
    sublime_text: '>=4050',
    python: '3.8',
  };
}

export function parseBuildArgs(argv) {
  const opts = { out: 'release', zip: true, link: false, install: false, uninstall: false, packagesDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--out':
        opts.out = argv[++i] ?? opts.out;
        break;
      case '--no-zip':
        opts.zip = false;
        break;
      case '--link':
        opts.link = true;
        break;
      case '--install':
        opts.install = true;
        break;
      case '--uninstall':
        opts.uninstall = true;
        break;
      case '--packages-dir':
        opts.packagesDir = argv[++i] ?? null;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${a}`);
    }
  }
  if (opts.link && opts.install) throw new Error('--link and --install are mutually exclusive');
  return opts;
}

/** Package file name for a version. */
export function packageFileName(version) {
  return `iMark-${version}.sublime-package`;
}
