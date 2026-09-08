// Build script: bundles the extension host code (Node/CJS), the webview
// (browser/ESM with code splitting for lazy language modes), the Sublime Text
// browser bridge, the browser dev
// harness, and (optionally) the VS Code integration tests.
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const dev = args.has('--dev');
const tests = args.has('--tests');
const production = args.has('--production');

const root = path.dirname(new URL(import.meta.url).pathname);

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'es2022',
  outdir: 'dist/webview',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
};

/** @type {import('esbuild').BuildOptions} */
const harnessConfig = {
  entryPoints: ['dev/harness.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/dev/harness.js',
  sourcemap: true,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const sublimeBridgeConfig = {
  entryPoints: ['src/sublime/bridge.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/sublime/bridge.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const testConfig = {
  entryPoints: ['test/vscode/runTest.ts', 'test/vscode/suite/index.ts', 'test/vscode/suite/extension.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: 'out-test',
  external: ['vscode', 'mocha', '@vscode/test-electron'],
  sourcemap: true,
  logLevel: 'info',
};

async function copyStatic() {
  await mkdir('dist/webview/katex', { recursive: true });
  await cp('node_modules/katex/dist/katex.min.css', 'dist/webview/katex/katex.min.css');
  await cp('node_modules/katex/dist/fonts', 'dist/webview/katex/fonts', { recursive: true });
}

async function main() {
  if (tests) {
    await esbuild.build(testConfig);
    return;
  }
  if (!watch) {
    await rm('dist', { recursive: true, force: true });
  }
  await copyStatic();
  const configs = [extensionConfig, webviewConfig, sublimeBridgeConfig];
  if (dev || existsSync(path.join(root, 'dev/harness.ts'))) configs.push(harnessConfig);
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('[esbuild] watching…');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
