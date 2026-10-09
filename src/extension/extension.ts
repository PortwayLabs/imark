import * as vscode from 'vscode';
import * as path from 'node:path';
import { IMarkEditorProvider, VIEW_TYPE } from './editorProvider';
import { DEFAULT_THEME, ThemeManager, type ThemeEntry } from './themeManager';
import { FileIndex } from './fileIndex';
import { ThemeGallery } from './themeGallery';

export function activate(context: vscode.ExtensionContext): void {
  const themes = new ThemeManager(context);
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

  // ---- Theme import ------------------------------------------------------------------

  async function importThemes(preset?: vscode.Uri[]): Promise<ThemeEntry[]> {
    const picked =
      preset ??
      (await vscode.window.showOpenDialog({
        title: 'iMark: Import Obsidian theme(s)',
        openLabel: 'Import',
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: true,
        defaultUri: themes.suggestedImportDir(provider.activeDocument?.uri),
        filters: { 'Theme / snippet CSS': ['css'], 'All files': ['*'] },
      }));
    if (!picked || !picked.length) return [];
    const result = await themes.importFrom(picked.map((u) => u.fsPath));
    if (!result.themes.length && !result.snippets.length) {
      void vscode.window.showWarningMessage(
        'iMark: nothing to import. Pick a theme folder (containing theme.css), a themes folder, an Obsidian vault / .obsidian folder, or a .css snippet.',
      );
      return [];
    }
    const summary = [
      result.themes.length ? `${result.themes.length} theme${result.themes.length > 1 ? 's' : ''} (${result.themes.map((t) => t.name).join(', ')})` : '',
      result.snippets.length ? `${result.snippets.length} snippet${result.snippets.length > 1 ? 's' : ''}` : '',
    ]
      .filter(Boolean)
      .join(' and ');

    if (result.plan.appearance) {
      const a = result.plan.appearance;
      const details = [a.cssTheme ? `theme "${a.cssTheme}"` : '', a.theme ? `base ${a.theme}` : '', a.accentColor ? `accent ${a.accentColor}` : '', a.enabledCssSnippets?.length ? `${a.enabledCssSnippets.length} snippet(s)` : '']
        .filter(Boolean)
        .join(', ');
      const choice = await vscode.window.showInformationMessage(
        `iMark imported ${summary}. This vault's appearance settings (${details}) can be applied to iMark as well.`,
        { modal: true },
        'Apply appearance settings',
        'Just import',
      );
      if (choice === 'Apply appearance settings') {
        const applied = await themes.applyAppearance(result.plan, result);
        void vscode.window.showInformationMessage(`iMark: applied ${applied.join(', ') || 'nothing'}.`);
        return result.themes;
      }
    } else if (result.themes.length === 1) {
      const t = result.themes[0];
      const choice = await vscode.window.showInformationMessage(`iMark imported ${summary}.`, 'Use this theme');
      if (choice) await themes.setTheme(t.id);
      return result.themes;
    } else if (result.snippets.length && !result.themes.length) {
      const names = result.snippets.map((s) => path.basename(s));
      const cfg = vscode.workspace.getConfiguration('imark.theme');
      const current = cfg.get<string[]>('snippets', []);
      const merged = [...new Set([...current, ...names])];
      await cfg.update('snippets', merged, themes.targetFor('snippets'));
      void vscode.window.showInformationMessage(`iMark imported and enabled ${summary}.`);
      return [];
    }
    void vscode.window.showInformationMessage(`iMark imported ${summary}.`);
    return result.themes;
  }

  async function selectTheme(): Promise<void> {
    type Item = vscode.QuickPickItem & { value?: string; action?: 'import' | 'folder' | 'browse' | 'manage'; theme?: ThemeEntry };
    const removeButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Remove this theme from iMark' };
    const build = (): Item[] => {
      const cfg = vscode.workspace.getConfiguration('imark.theme');
      let current = cfg.get<string>('name', DEFAULT_THEME);
      if (current === 'auto' || current === '') current = DEFAULT_THEME;
      const list = themes.listThemes();
      const themeItem = (t: ThemeEntry): Item => ({
        label: `$(symbol-color) ${t.name}`,
        description: [t.author ? `by ${t.author}` : '', t.version ?? '', t.origin === 'external' ? '(external folder)' : t.origin === 'bundled' ? '(built-in)' : ''].filter(Boolean).join(' · '),
        value: t.id,
        theme: t,
        buttons: t.origin === 'library' ? [removeButton] : [],
      });
      const items: Item[] = [
        { label: 'Built-in', kind: vscode.QuickPickItemKind.Separator },
        ...list.filter((t) => t.origin === 'bundled').map(themeItem),
        { label: '$(color-mode) Follow VS Code', description: 'adapt Obsidian variables to the VS Code color theme', value: 'vscode' },
        { label: '$(paintcan) Obsidian default', description: 'Obsidian default look', value: 'obsidian' },
      ];
      const imported = list.filter((t) => t.origin !== 'bundled');
      if (imported.length) {
        items.push({ label: 'Imported themes', kind: vscode.QuickPickItemKind.Separator });
        for (const t of imported) items.push(themeItem(t));
      }
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(extensions) Browse community themes…', description: 'download Obsidian community themes', action: 'browse' },
        { label: '$(settings-gear) Manage themes…', description: 'update, remove and clean up installed themes', action: 'manage' },
        { label: '$(cloud-download) Import theme…', description: 'pick a theme folder, a themes folder, an Obsidian vault or a .css snippet', action: 'import' },
        { label: '$(folder-opened) Open iMark themes folder', description: themes.libraryDir, action: 'folder' },
      );
      for (const it of items) if (it.value && it.value === current) it.description = `${it.description ?? ''} — current`.replace(/^ — /, '');
      return items;
    };

    const qp = vscode.window.createQuickPick<Item>();
    qp.title = 'iMark: Select theme';
    qp.placeholder = 'Themes are stored in iMark\'s own library; the selection is saved in VS Code settings';
    qp.matchOnDescription = true;
    qp.items = build();
    qp.onDidTriggerItemButton(async (e) => {
      const t = e.item.theme;
      if (!t) return;
      const ok = await vscode.window.showWarningMessage(`Remove theme "${t.name}" from iMark?`, { modal: true }, 'Remove');
      if (ok !== 'Remove') return;
      await themes.removeTheme(t.id);
      const cfg = vscode.workspace.getConfiguration('imark.theme');
      if (cfg.get<string>('name') === t.id) await themes.setTheme(DEFAULT_THEME);
      qp.items = build();
    });
    qp.onDidAccept(async () => {
      const picked = qp.selectedItems[0];
      if (!picked) return;
      if (picked.action === 'import') {
        qp.hide();
        const imported = await importThemes();
        if (imported.length > 1) await selectTheme();
        return;
      }
      if (picked.action === 'browse' || picked.action === 'manage') {
        qp.hide();
        ThemeGallery.show(context, themes, { importThemes }, picked.action === 'browse' ? 'community' : 'installed');
        return;
      }
      if (picked.action === 'folder') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(themes.libraryDir));
        return;
      }
      if (picked.value) {
        await themes.setTheme(picked.value);
        qp.hide();
      }
    });
    qp.onDidHide(() => qp.dispose());
    qp.show();
  }

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
    vscode.commands.registerCommand('imark.selectTheme', () => selectTheme()),
    vscode.commands.registerCommand('imark.importTheme', (uri?: vscode.Uri) => importThemes(uri instanceof vscode.Uri ? [uri] : undefined)),
    vscode.commands.registerCommand('imark.removeTheme', async () => {
      const list = themes.listThemes().filter((t) => t.origin === 'library');
      if (!list.length) {
        void vscode.window.showInformationMessage('iMark: no imported themes.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        list.map((t) => ({ label: t.name, description: t.author ? `by ${t.author}` : '', detail: t.dir, id: t.id })),
        { title: 'iMark: Remove theme', placeHolder: 'Select a theme to remove from iMark' },
      );
      if (!picked) return;
      await themes.removeTheme(picked.id);
      if (vscode.workspace.getConfiguration('imark.theme').get<string>('name') === picked.id) await themes.setTheme(DEFAULT_THEME);
    }),
    vscode.commands.registerCommand('imark.manageThemes', () => ThemeGallery.show(context, themes, { importThemes }, 'installed')),
    vscode.commands.registerCommand('imark.browseThemes', () => ThemeGallery.show(context, themes, { importThemes }, 'community')),
    vscode.commands.registerCommand('imark.openThemesFolder', () => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(themes.libraryDir))),
  );
}

export function deactivate(): void {
  /* nothing */
}
