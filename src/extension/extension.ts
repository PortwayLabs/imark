import * as vscode from 'vscode';
import { IMarkEditorProvider, VIEW_TYPE } from './editorProvider';
import { ThemeManager } from './themeManager';
import { FileIndex } from './fileIndex';

export function activate(context: vscode.ExtensionContext): void {
  const themes = new ThemeManager();
  const files = new FileIndex();
  const provider = new IMarkEditorProvider(context, themes, files);
  context.subscriptions.push(
    themes,
    files,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );

  const activeMarkdownUri = (uri?: vscode.Uri): vscode.Uri | undefined => {
    if (uri instanceof vscode.Uri) return uri;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input as { uri?: vscode.Uri } | undefined;
    if (input?.uri) return input.uri;
    return provider.activeDocument?.uri ?? vscode.window.activeTextEditor?.document.uri;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('imark.openInIMark', async (uri?: vscode.Uri) => {
      const target = activeMarkdownUri(uri);
      if (!target) return;
      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('imark.openSource', async (uri?: vscode.Uri) => {
      const target = activeMarkdownUri(uri);
      if (!target) return;
      await vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }),
    vscode.commands.registerCommand('imark.toggleReadingView', () => {
      if (!provider.postToActive({ type: 'toggleReading' })) void vscode.window.showInformationMessage('iMark: no active iMark editor.');
    }),
    vscode.commands.registerCommand('imark.toggleSourceMode', () => {
      if (!provider.postToActive({ type: 'toggleSource' })) void vscode.window.showInformationMessage('iMark: no active iMark editor.');
    }),
    vscode.commands.registerCommand('imark.reloadTheme', () => themes.reload()),
    vscode.commands.registerCommand('imark.toggleReadableLineWidth', async () => {
      const cfg = vscode.workspace.getConfiguration('imark.editor');
      const current = cfg.get<boolean>('readableLineWidth', true);
      await cfg.update('readableLineWidth', !current, vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('imark.selectTheme', async () => {
      const doc = provider.activeDocument?.uri ?? vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!doc) {
        void vscode.window.showInformationMessage('iMark: open a Markdown file first.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('imark.theme');
      const current = cfg.get<string>('name', 'auto');
      const list = themes.listThemes(doc);
      const themesDir = themes.themesDir(doc);
      type Item = vscode.QuickPickItem & { value: string };
      const items: Item[] = [
        { label: '$(sync) Auto', description: "use the vault's .obsidian/appearance.json", value: 'auto' },
        { label: '$(color-mode) Follow VS Code', description: 'adapt Obsidian variables to the VS Code color theme', value: 'vscode' },
        { label: '$(paintcan) Obsidian default', description: 'Obsidian default look', value: 'obsidian' },
        ...list.map((t) => ({ label: `$(symbol-color) ${t.name}`, description: t.author ? `by ${t.author}` : '', detail: t.dir, value: t.id })),
      ];
      for (const it of items) if (it.value === current) it.picked = true;
      const picked = await vscode.window.showQuickPick(items, {
        title: themesDir ? `iMark: Obsidian themes in ${themesDir}` : 'iMark: no Obsidian themes folder found (set imark.theme.path)',
        placeHolder: 'Select a theme',
        matchOnDescription: true,
      });
      if (!picked) return;
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await cfg.update('name', picked.value, target);
    }),
  );
}

export function deactivate(): void {
  /* nothing */
}
