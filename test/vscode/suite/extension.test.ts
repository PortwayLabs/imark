import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite('iMark extension', () => {
  test('activates and opens a Markdown file in the iMark custom editor', async () => {
    const ext = vscode.extensions.getExtension('imark.imark');
    assert.ok(ext, 'extension should be present');
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'fixture workspace should be open');
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, 'note.md'));
    await vscode.commands.executeCommand('vscode.openWith', uri, 'imark.editor');
    await wait(1500);
    assert.ok(ext.isActive, 'extension should be active');
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab, 'a tab should be active');
    const input = tab.input as vscode.TabInputCustom;
    assert.strictEqual(input.viewType, 'imark.editor');
    assert.strictEqual(input.uri.fsPath, uri.fsPath);
  });

  test('external edits to the document do not break the session', async () => {
    const folder = vscode.workspace.workspaceFolders![0];
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, 'note.md'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), '<!-- test -->\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await wait(500);
    assert.ok(doc.getText().startsWith('<!-- test -->'));
    // revert
    const undo = new vscode.WorkspaceEdit();
    undo.delete(uri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)));
    assert.ok(await vscode.workspace.applyEdit(undo));
    await wait(300);
    assert.ok(!doc.getText().startsWith('<!-- test -->'));
  });

  test('commands are registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['imark.openInIMark', 'imark.openSource', 'imark.toggleReadingView', 'imark.toggleSourceMode', 'imark.selectTheme', 'imark.reloadTheme', 'imark.toggleReadableLineWidth']) {
      assert.ok(cmds.includes(c), `${c} should be registered`);
    }
  });
});
