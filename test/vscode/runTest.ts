import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
  const workspace = path.resolve(__dirname, '..', 'test', 'fixtures');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-extensions', '--disable-gpu'],
  });
}

main().catch((e) => {
  console.error('Failed to run tests', e);
  process.exit(1);
});
