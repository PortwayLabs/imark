#!/usr/bin/env node
// Build the Sublime Text package.
//
//   node scripts/build-sublime.mjs [--out release] [--no-zip] [--install|--link] [--uninstall] [--packages-dir <dir>]
//
// Default: stage the package (Python sources from sublime/iMark + the built editor
// bundle, CSS and bundled themes under web/) into dist/sublime/iMark and zip it
// into release/iMark-<version>.sublime-package.
//   --install   copy the staged package into Sublime Text's Packages/iMark
//   --link      development mode: symlink Packages/iMark → sublime/iMark and
//               create web/ symlinks to dist/ and media/ so Python edits reload
//               instantly and `npm run watch` updates the editor in place
//   --uninstall remove Packages/iMark (only when it was created by this script)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packageFileName, packageMetadata, parseBuildArgs, shouldPackage, sublimePackagesDir } from './sublime-lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);

const HELP = `iMark Sublime Text package build

Usage: node scripts/build-sublime.mjs [options]

Options:
  --out <dir>          Directory for the .sublime-package (default: release)
  --no-zip             Stage only, do not create the .sublime-package
  --install            Copy the staged package to <Packages>/iMark
  --link               Symlink <Packages>/iMark to sublime/iMark for development
  --uninstall          Remove <Packages>/iMark created by --install / --link
  --packages-dir <dir> Sublime Text Packages directory (default: per platform, or $SUBLIME_PACKAGES)
  -h, --help           Show this help
`;

const SOURCE = path.join(root, 'sublime', 'iMark');
const STAGE = path.join(root, 'dist', 'sublime', 'iMark');
const WEB_SOURCES = [
  ['dist/webview', 'webview'],
  ['dist/sublime/bridge.js', 'sublime/bridge.js'],
  ['media/css', 'css'],
  ['media/themes', 'themes'],
  ['media/icons/imark.png', 'icons/imark.png'],
];

const info = (msg) => console.log(`    ${msg}`);
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};

function copyFiltered(src, dest, base) {
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const rel = path.relative(base, p).split(path.sep).join('/');
      return rel === '' || shouldPackage(rel);
    },
  });
}

function checkBuilt() {
  for (const [src] of WEB_SOURCES) if (!existsSync(path.join(root, src))) fail(`${src} is missing — run "npm run build" first.`);
}

function stage(pkg) {
  checkBuilt();
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  copyFiltered(SOURCE, STAGE, SOURCE);
  // Remove development symlinks / metadata that may exist in the source tree (from --link).
  for (const rel of ['web', 'imark-package.json']) {
    const p = path.join(STAGE, rel);
    if (existsSync(p) || isSymlink(p)) rmSync(p, { recursive: true, force: true });
  }
  for (const [src, dest] of WEB_SOURCES) {
    const from = path.join(root, src);
    const to = path.join(STAGE, 'web', dest);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFiltered(from, to, from);
  }
  cpSync(path.join(root, 'LICENSE'), path.join(STAGE, 'LICENSE'));
  writeFileSync(path.join(STAGE, 'imark-package.json'), JSON.stringify(packageMetadata(pkg), null, 2) + '\n');
  info(`staged ${path.relative(root, STAGE)}`);
  return STAGE;
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function zipDirectory(dir, zipPath) {
  mkdirSync(path.dirname(zipPath), { recursive: true });
  rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    const tmp = `${zipPath}.zip`;
    const res = spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${dir}\\*" -DestinationPath "${tmp}" -Force`], { stdio: 'inherit' });
    if (res.status !== 0) fail('Compress-Archive failed');
    cpSync(tmp, zipPath);
    rmSync(tmp);
    return;
  }
  const probe = spawnSync('zip', ['-v'], { stdio: 'ignore' });
  if (probe.error) fail('The "zip" command is required to create the .sublime-package (or pass --no-zip).');
  const res = spawnSync('zip', ['-qr', '-X', path.resolve(zipPath), '.'], { cwd: dir, stdio: 'inherit' });
  if (res.status !== 0) fail('zip failed');
}

function ownedByUs(target) {
  if (isSymlink(target)) return true;
  return existsSync(path.join(target, 'imark-package.json')) || existsSync(path.join(target, 'imark.py'));
}

function removeInstalled(target) {
  if (!existsSync(target) && !isSymlink(target)) {
    info(`nothing installed at ${target}`);
    return;
  }
  if (!ownedByUs(target)) fail(`${target} does not look like an iMark package; refusing to remove it.`);
  if (isSymlink(target)) unlinkSync(target);
  else rmSync(target, { recursive: true, force: true });
  info(`removed ${target}`);
}

function install(staged, target) {
  if ((existsSync(target) || isSymlink(target)) && !ownedByUs(target)) fail(`${target} exists and is not an iMark package; remove it first.`);
  if (isSymlink(target)) unlinkSync(target);
  else rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(staged, target, { recursive: true });
  info(`installed to ${target}`);
}

function link(pkg, target) {
  checkBuilt();
  // web/ inside the source package: symlinks to the build outputs.
  const web = path.join(SOURCE, 'web');
  rmSync(web, { recursive: true, force: true });
  mkdirSync(web, { recursive: true });
  for (const [src, dest] of WEB_SOURCES) {
    const to = path.join(web, dest);
    mkdirSync(path.dirname(to), { recursive: true });
    symlinkSync(path.join(root, src), to, existsSync(path.join(root, src)) && lstatSync(path.join(root, src)).isDirectory() ? 'dir' : 'file');
  }
  writeFileSync(path.join(SOURCE, 'imark-package.json'), JSON.stringify({ ...packageMetadata(pkg), version: `${pkg.version}-dev` }, null, 2) + '\n');
  if (existsSync(target) || isSymlink(target)) {
    if (!ownedByUs(target)) fail(`${target} exists and is not an iMark package; remove it first.`);
    if (isSymlink(target)) {
      if (path.resolve(readlinkSync(target)) === SOURCE) {
        info(`already linked: ${target} → ${SOURCE}`);
        return;
      }
      unlinkSync(target);
    } else rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(SOURCE, target, 'dir');
  info(`linked ${target} → ${SOURCE}`);
}

function main() {
  let opts;
  try {
    opts = parseBuildArgs(process.argv.slice(2));
  } catch (e) {
    console.error(HELP);
    fail(e.message);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const packagesDir = opts.packagesDir ?? sublimePackagesDir({ exists: existsSync });
  const target = path.join(packagesDir, 'iMark');
  console.log(`iMark Sublime Text package v${pkg.version}`);

  if (opts.uninstall) {
    removeInstalled(target);
    return;
  }
  if (opts.link) {
    link(pkg, target);
    return;
  }
  const staged = stage(pkg);
  if (opts.zip) {
    const zipPath = path.join(opts.out, packageFileName(pkg.version));
    zipDirectory(staged, zipPath);
    info(`created ${zipPath}`);
  }
  if (opts.install) install(staged, target);
}

main();
