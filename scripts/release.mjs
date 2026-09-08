#!/usr/bin/env node
// iMark release script.
//
//   node scripts/release.mjs <patch|minor|major|x.y.z> [options]
//
// Steps: preflight (clean tree, tag free, nls keys) → bump version → update the
// English and Chinese changelogs → typecheck → unit tests → VS Code integration
// tests → production build → package VSIX into release/ → commit + tag →
// optionally push / publish to the Marketplace / create a GitHub release.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bumpVersion, missingNlsKeys, parseArgs, prepareChangelog, today } from './release-lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);

const HELP = `iMark release script

Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [options]

Options:
  --dry-run             Validate, test and build, but do not change files, git or publish
  --skip-tests          Skip unit tests
  --skip-vscode-tests   Skip the VS Code integration tests (they download VS Code once)
  --skip-changelog      Do not require / rewrite changelog sections
  --no-git              Do not commit or tag
  --push                Push the release commit and tag to origin
  --publish             Publish the VSIX to the Marketplace (needs VSCE_PAT)
  --github-release      Create a GitHub release with the VSIX attached (needs gh)
  --allow-dirty         Allow uncommitted changes in the working tree
  --out <dir>           Directory for the VSIX (default: release)
  -h, --help            Show this help

Examples:
  npm run release -- patch
  npm run release -- minor --push --github-release
  npm run release -- 1.0.0 --dry-run
`;

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

let stepNo = 0;
const step = (title) => console.log(`\n${c.bold(`[${++stepNo}] ${title}`)}`);
const info = (msg) => console.log(`    ${msg}`);
const fail = (msg) => {
  console.error(`\n${c.red('✖')} ${msg}`);
  process.exit(1);
};

function run(cmd, args, { capture = false, env = {} } = {}) {
  info(c.dim(`$ ${cmd} ${args.join(' ')}`));
  const res = spawnSync(cmd, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (res.error) fail(`${cmd} failed to start: ${res.error.message}`);
  if (res.status !== 0) {
    if (capture) process.stderr.write(res.stderr ?? '');
    fail(`${cmd} ${args.join(' ')} exited with code ${res.status}`);
  }
  return (res.stdout ?? '').trim();
}

function git(args, opts) {
  return run('git', args, { capture: true, ...opts });
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(HELP);
    fail(e.message);
  }
  if (opts.help || !opts.bump) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const pkg = readJson('package.json');
  const current = pkg.version;
  let next;
  try {
    next = bumpVersion(current, opts.bump);
  } catch (e) {
    fail(e.message);
  }
  const tag = `v${next}`;
  const date = today();
  const changelogs = ['CHANGELOG.md', 'CHANGELOG.zh-CN.md'].filter(existsSync);

  console.log(c.bold(`iMark release ${current} → ${next}${opts.dryRun ? c.yellow(' (dry run)') : ''}`));

  // ---- Preflight -------------------------------------------------------------------
  step('Preflight checks');
  const dirty = git(['status', '--porcelain']);
  if (dirty && !opts.allowDirty) {
    fail(`Working tree is not clean. Commit or stash first, or pass --allow-dirty.\n${dirty}`);
  }
  if (!opts.noGit && git(['tag', '--list', tag])) fail(`Tag ${tag} already exists.`);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  info(`branch: ${branch}, tag: ${tag}, date: ${date}`);

  const bundles = {};
  for (const f of ['package.nls.json', 'package.nls.zh-cn.json']) if (existsSync(f)) bundles[f] = readJson(f);
  const missing = missingNlsKeys(pkg, bundles);
  if (Object.keys(missing).length) fail(`Missing localization keys: ${JSON.stringify(missing, null, 2)}`);
  info(`nls bundles ok (${Object.keys(bundles).join(', ')})`);

  const prepared = {};
  if (!opts.skipChangelog) {
    for (const f of changelogs) {
      try {
        prepared[f] = prepareChangelog(readFileSync(f, 'utf8'), next, date);
        info(`${f}: release section ready (${prepared[f].body.split('\n').length} line(s))`);
      } catch (e) {
        fail(`${f}: ${e.message}. Add a "## Unreleased" (or "## 未发布") section describing this release.`);
      }
    }
  }
  if (opts.publish && !process.env.VSCE_PAT) fail('--publish requires the VSCE_PAT environment variable.');
  if (opts.githubRelease) run('gh', ['--version'], { capture: true });

  // ---- Checks --------------------------------------------------------------------------
  step('Type check');
  run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);

  if (!opts.skipTests) {
    step('Unit tests');
    run('npx', ['vitest', 'run']);
  }
  if (!opts.skipVscodeTests) {
    step('VS Code integration tests');
    run('node', ['esbuild.mjs', '--tests']);
    run('node', ['out-test/runTest.js']);
  }

  step('Production build');
  run('node', ['esbuild.mjs', '--production']);

  if (opts.dryRun) {
    console.log(`\n${c.green('✔')} Dry run finished. Would release ${c.bold(tag)}:`);
    for (const [f, p] of Object.entries(prepared)) console.log(`\n${c.dim(`--- ${f} ---`)}\n${p.body}`);
    return;
  }

  // ---- Version + changelog --------------------------------------------------------------
  step(`Bump version to ${next}`);
  run('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], { capture: true });
  for (const [f, p] of Object.entries(prepared)) {
    writeFileSync(f, p.text);
    info(`updated ${f}`);
  }

  // ---- Package ----------------------------------------------------------------------------
  step('Package VSIX');
  mkdirSync(opts.out, { recursive: true });
  const vsixName = `${pkg.name}-${next}.vsix`;
  const vsixPath = path.join(opts.out, vsixName);
  run('npx', ['vsce', 'package', '--no-dependencies', '--out', vsixPath]);
  if (!existsSync(vsixPath)) {
    // Older vsce versions ignore --out for directories; move the file if needed.
    if (existsSync(vsixName)) renameSync(vsixName, vsixPath);
    else fail(`Expected ${vsixPath} to exist after packaging.`);
  }
  info(c.green(`created ${vsixPath}`));

  // ---- Git -----------------------------------------------------------------------------------
  if (!opts.noGit) {
    step('Commit and tag');
    const files = ['package.json', ...(existsSync('package-lock.json') ? ['package-lock.json'] : []), ...Object.keys(prepared)];
    run('git', ['add', ...files]);
    run('git', ['commit', '-m', `chore(release): ${tag}`]);
    const notes = Object.values(prepared)
      .map((p) => p.body)
      .join('\n\n');
    run('git', ['tag', '-a', tag, '-m', `iMark ${tag}\n\n${notes}`]);
    info(`tagged ${tag}`);
    if (opts.push) {
      step('Push');
      run('git', ['push', 'origin', branch]);
      run('git', ['push', 'origin', tag]);
    }
  }

  // ---- Publish -----------------------------------------------------------------------------------
  if (opts.publish) {
    step('Publish to Marketplace');
    run('npx', ['vsce', 'publish', '--no-dependencies', '--packagePath', vsixPath], { env: { VSCE_PAT: process.env.VSCE_PAT } });
  }
  if (opts.githubRelease) {
    step('GitHub release');
    const notesFile = path.join(opts.out, `notes-${next}.md`);
    const notes = Object.entries(prepared)
      .map(([f, p]) => `${f.includes('zh') ? '## 更新内容' : '## Changes'}\n\n${p.body}`)
      .join('\n\n');
    writeFileSync(notesFile, notes || `iMark ${tag}`);
    run('gh', ['release', 'create', tag, vsixPath, '--title', `iMark ${tag}`, '--notes-file', notesFile]);
  }

  console.log(`\n${c.green('✔')} Released ${c.bold(tag)} → ${vsixPath}`);
  console.log(`   Install locally: code --install-extension ${vsixPath}`);
  if (!opts.push && !opts.noGit) console.log(`   Push when ready: git push origin ${branch} && git push origin ${tag}`);
}

main().catch((e) => fail(e.stack ?? String(e)));
