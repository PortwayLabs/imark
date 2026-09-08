// CustomTextEditorProvider hosting the iMark webview and keeping the
// TextDocument and the webview's CodeMirror document in sync.
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DocumentInfo, EditorConfig, EditorMode, HostMessage, InitMessage, ResourceRoot, TextChange, WebviewMessage } from '../shared/protocol';
import { applyChanges, normalizeEol } from '../shared/protocol';
import { MD_EXT, parseTarget } from '../shared/linkResolve';
import type { ThemeManager } from './themeManager';
import type { FileIndex } from './fileIndex';
import { saveAttachment } from './attachments';

export const VIEW_TYPE = 'imark.editor';

interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  /** Text the webview is believed to hold (LF line endings). */
  shadow: string;
  /** Generation counter bumped on every external reset. */
  gen: number;
  ready: boolean;
  mode: EditorMode;
  disposables: vscode.Disposable[];
}

/** Convert an offset in LF-normalised text to a VS Code Position. */
function positionAt(text: string, offset: number): vscode.Position {
  let line = 0;
  let lastBreak = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return new vscode.Position(line, offset - lastBreak - 1);
}

export class IMarkEditorProvider implements vscode.CustomTextEditorProvider {
  private sessions = new Set<Session>();
  private active: Session | null = null;
  private readonly statusMode: vscode.StatusBarItem;
  private readonly statusStats: vscode.StatusBarItem;
  private readonly activeEmitter = new vscode.EventEmitter<Session | null>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly themes: ThemeManager,
    private readonly files: FileIndex,
  ) {
    this.statusMode = vscode.window.createStatusBarItem('imark.mode', vscode.StatusBarAlignment.Right, 101);
    this.statusMode.name = 'iMark mode';
    this.statusMode.command = 'imark.toggleReadingView';
    this.statusStats = vscode.window.createStatusBarItem('imark.stats', vscode.StatusBarAlignment.Right, 100);
    this.statusStats.name = 'iMark word count';
    context.subscriptions.push(
      this.statusMode,
      this.statusStats,
      themes.onDidChange(() => this.broadcastTheme()),
      files.onDidChange(() => this.broadcastFiles()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('imark.editor') || e.affectsConfiguration('imark.attachments') || e.affectsConfiguration('editor.tabSize') || e.affectsConfiguration('editor.insertSpaces')) {
          for (const s of this.sessions) this.post(s, { type: 'config', config: this.configFor(s.document) });
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)),
      vscode.workspace.onDidRenameFiles((e) => {
        for (const s of this.sessions) {
          if (e.files.some((f) => f.newUri.toString() === s.document.uri.toString())) this.post(s, { type: 'documentInfo', doc: this.docInfo(s.document) });
        }
      }),
    );
  }

  // ---- lifecycle -----------------------------------------------------------------

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const session: Session = {
      document,
      panel,
      shadow: normalizeEol(document.getText()),
      gen: 1,
      ready: false,
      mode: this.editorConfig().get<EditorMode>('defaultMode', 'live'),
      disposables: [],
    };
    this.sessions.add(session);
    const resolved = this.themes.resolve(document.uri);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.resourceRoots(document.uri, resolved),
    };
    panel.webview.html = this.html(panel.webview);

    session.disposables.push(
      panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(session, m)),
      panel.onDidChangeViewState(() => {
        if (panel.active) this.setActive(session);
        else if (this.active === session) this.setActive(null);
      }),
    );
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      for (const d of session.disposables) d.dispose();
      if (this.active === session) this.setActive(null);
    });
    if (panel.active) this.setActive(session);
  }

  private setActive(session: Session | null) {
    this.active = session;
    void vscode.commands.executeCommand('setContext', 'imark.active', !!session);
    this.updateStatus();
    this.activeEmitter.fire(session);
  }

  private updateStatus() {
    const s = this.active;
    if (!s) {
      this.statusMode.hide();
      this.statusStats.hide();
      return;
    }
    const labels: Record<EditorMode, string> = { live: '$(book) Live Preview', source: '$(code) Source', reading: '$(open-preview) Reading' };
    this.statusMode.text = labels[s.mode];
    this.statusMode.tooltip = 'iMark: click to toggle reading view';
    this.statusMode.show();
    this.statusStats.show();
  }

  // ---- outgoing ----------------------------------------------------------------------

  private post(session: Session, msg: HostMessage) {
    void session.panel.webview.postMessage(msg);
  }

  postToActive(msg: HostMessage): boolean {
    if (!this.active) return false;
    this.post(this.active, msg);
    return true;
  }

  get activeDocument(): vscode.TextDocument | undefined {
    return this.active?.document;
  }

  private broadcastTheme() {
    for (const s of this.sessions) {
      const resolved = this.themes.resolve(s.document.uri);
      s.panel.webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots(s.document.uri, resolved) };
      this.post(s, { type: 'theme', theme: this.themes.toThemeInfo(s.panel.webview, this.context.extensionUri, resolved) });
    }
  }

  private async broadcastFiles() {
    for (const s of this.sessions) {
      if (!s.ready) continue;
      this.post(s, { type: 'fileIndex', files: await this.files.filesFor(s.document.uri) });
    }
  }

  // ---- incoming -----------------------------------------------------------------------

  private async onMessage(session: Session, msg: WebviewMessage) {
    switch (msg.type) {
      case 'ready':
        await this.sendInit(session);
        break;
      case 'edit':
        await this.applyWebviewEdit(session, msg.gen, msg.changes);
        break;
      case 'openLink':
        await this.openLink(session, msg.href);
        break;
      case 'openWikilink':
        await this.openWikilink(session, msg.target);
        break;
      case 'searchTag':
        await vscode.commands.executeCommand('workbench.action.findInFiles', { query: `#${msg.tag}`, triggerSearch: true, isRegex: false, matchWholeWord: false });
        break;
      case 'readFile': {
        const uri = await this.files.resolve(session.document.uri, msg.target);
        let text: string | null = null;
        if (uri && MD_EXT.test(uri.fsPath)) {
          try {
            const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
            text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
          } catch {
            text = null;
          }
        }
        this.post(session, { type: 'fileContent', id: msg.id, text });
        break;
      }
      case 'saveAttachment': {
        try {
          const folder = vscode.workspace.getConfiguration('imark.attachments', session.document.uri).get<string>('folder', 'assets');
          const saved = await saveAttachment(session.document.uri, folder, msg.name, msg.mime, msg.data);
          this.post(session, { type: 'attachmentSaved', id: msg.id, relPath: saved.relPath, name: saved.name });
        } catch (e) {
          this.post(session, { type: 'attachmentSaved', id: msg.id, relPath: '', name: '', error: String(e) });
        }
        break;
      }
      case 'modeChanged':
        session.mode = msg.mode;
        if (this.active === session) this.updateStatus();
        break;
      case 'stats':
        if (this.active === session) {
          this.statusStats.text = `${msg.words} words, ${msg.characters} characters`;
          this.statusStats.tooltip = 'iMark word count';
        }
        break;
      case 'notify':
        if (msg.level === 'error') void vscode.window.showErrorMessage(msg.message);
        else if (msg.level === 'warn') void vscode.window.showWarningMessage(msg.message);
        else void vscode.window.showInformationMessage(msg.message);
        break;
      case 'command':
        if (msg.command === 'openSource') await vscode.commands.executeCommand('imark.openSource', session.document.uri);
        else if (msg.command === 'selectTheme') await vscode.commands.executeCommand('imark.selectTheme');
        else if (msg.command === 'toggleReadableLineWidth') await vscode.commands.executeCommand('imark.toggleReadableLineWidth');
        break;
      case 'webviewFocus':
        void vscode.commands.executeCommand('setContext', 'imark.webviewFocus', msg.focused);
        break;
    }
  }

  private async sendInit(session: Session) {
    const { document, panel } = session;
    session.shadow = normalizeEol(document.getText());
    session.gen++;
    session.ready = true;
    const resolved = this.themes.resolve(document.uri);
    const roots = this.files.rootsFor(document.uri);
    const resourceRoots: ResourceRoot[] = roots.map((r) => ({ fsPath: r.fsPath.split(path.sep).join('/'), webviewUri: panel.webview.asWebviewUri(r).toString() }));
    const init: InitMessage = {
      type: 'init',
      text: session.shadow,
      gen: session.gen,
      doc: this.docInfo(document),
      roots: resourceRoots,
      files: await this.files.filesFor(document.uri),
      config: this.configFor(document),
      theme: this.themes.toThemeInfo(panel.webview, this.context.extensionUri, resolved),
    };
    this.post(session, init);
  }

  private docInfo(document: vscode.TextDocument): DocumentInfo {
    const info = this.files.docInfo(document.uri);
    return {
      fsPath: document.uri.fsPath,
      title: path.basename(document.uri.fsPath).replace(MD_EXT, ''),
      root: info.root,
      path: info.path,
    };
  }

  private editorConfig(scope?: vscode.Uri) {
    return vscode.workspace.getConfiguration('imark.editor', scope);
  }

  private configFor(document: vscode.TextDocument): EditorConfig {
    const cfg = this.editorConfig(document.uri);
    const editor = vscode.workspace.getConfiguration('editor', { uri: document.uri, languageId: 'markdown' });
    const attachments = vscode.workspace.getConfiguration('imark.attachments', document.uri);
    const platform: EditorConfig['platform'] = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    return {
      mode: cfg.get<EditorMode>('defaultMode', 'live'),
      readableLineWidth: cfg.get<boolean>('readableLineWidth', true),
      showInlineTitle: cfg.get<boolean>('showInlineTitle', true),
      showHeader: cfg.get<boolean>('showHeader', true),
      fontSize: cfg.get<number>('fontSize', 0),
      lineNumbers: cfg.get<boolean>('lineNumbers', false),
      spellcheck: cfg.get<boolean>('spellcheck', false),
      autoPairMarkdown: cfg.get<boolean>('autoPairMarkdown', true),
      smartClickLinks: cfg.get<boolean>('smartClickLinks', true),
      tabSize: editor.get<number>('tabSize', 4),
      insertSpaces: editor.get<boolean>('insertSpaces', true),
      attachmentLinkStyle: attachments.get<'markdown' | 'wikilink'>('linkStyle', 'markdown'),
      platform,
    };
  }

  // ---- document sync -----------------------------------------------------------------------

  private async applyWebviewEdit(session: Session, gen: number, changes: TextChange[]) {
    if (gen !== session.gen) return; // stale: the webview was reset meanwhile
    if (!changes.length) return;
    const { document } = session;
    const before = session.shadow;
    if (normalizeEol(document.getText()) !== before) {
      // Out of sync (should not happen): resync the webview.
      this.resync(session);
      return;
    }
    const sorted = changes.slice().sort((a, b) => a.from - b.from);
    let next: string;
    try {
      next = applyChanges(before, sorted);
    } catch {
      this.resync(session);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const c of sorted) {
      edit.replace(document.uri, new vscode.Range(positionAt(before, c.from), positionAt(before, c.to)), c.insert);
    }
    session.shadow = next;
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok || normalizeEol(document.getText()) !== session.shadow) this.resync(session);
  }

  private resync(session: Session) {
    session.shadow = normalizeEol(session.document.getText());
    session.gen++;
    this.post(session, { type: 'update', text: session.shadow, gen: session.gen });
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    for (const s of this.sessions) {
      if (s.document.uri.toString() !== e.document.uri.toString() || !s.ready) continue;
      const text = normalizeEol(e.document.getText());
      if (text === s.shadow) continue; // our own edit
      s.shadow = text;
      s.gen++;
      this.post(s, { type: 'update', text, gen: s.gen });
    }
  }

  // ---- links ------------------------------------------------------------------------------------

  private async openLink(session: Session, href: string) {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^file:/i.test(trimmed)) {
      await vscode.env.openExternal(vscode.Uri.parse(trimmed));
      return;
    }
    let target: vscode.Uri;
    if (/^file:/i.test(trimmed)) target = vscode.Uri.parse(trimmed);
    else {
      let p = trimmed.split('#')[0];
      try {
        p = decodeURI(p);
      } catch {
        /* keep */
      }
      target = vscode.Uri.file(path.isAbsolute(p) ? p : path.resolve(path.dirname(session.document.uri.fsPath), p));
    }
    await this.openFile(target);
  }

  private async openWikilink(session: Session, raw: string) {
    const target = parseTarget(raw);
    if (!target.path) return; // same-note heading link
    let uri = await this.files.resolve(session.document.uri, target.path);
    if (!uri) {
      uri = this.files.newNoteUri(session.document.uri, target.path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
      await vscode.workspace.fs.writeFile(uri, new Uint8Array());
    }
    await this.openFile(uri);
  }

  private async openFile(uri: vscode.Uri) {
    try {
      if (MD_EXT.test(uri.fsPath)) await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      else await vscode.commands.executeCommand('vscode.open', uri);
    } catch (e) {
      void vscode.window.showErrorMessage(`iMark: could not open ${uri.fsPath}: ${String(e)}`);
    }
  }

  // ---- HTML ---------------------------------------------------------------------------------------

  private resourceRoots(docUri: vscode.Uri, resolved: ReturnType<ThemeManager['resolve']>): vscode.Uri[] {
    const roots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ...this.files.rootsFor(docUri),
      ...this.themes.resourceRoots(docUri, resolved),
    ];
    const seen = new Set<string>();
    return roots.filter((r) => {
      const k = r.toString();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const res = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p)).toString();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `media-src ${webview.cspSource} https: http: data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https: http:`,
      `font-src ${webview.cspSource} https: http: data:`,
      `script-src 'nonce-${nonce}'`,
      `connect-src ${webview.cspSource} https:`,
      `frame-src ${webview.cspSource} https:`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>iMark</title>
<link rel="stylesheet" href="${res('dist', 'webview', 'katex', 'katex.min.css')}">
<link rel="stylesheet" href="${res('media', 'css', 'obsidian-vars.css')}">
<link rel="stylesheet" href="${res('media', 'css', 'obsidian-base.css')}">
</head>
<body class="imark-body">
<script type="module" nonce="${nonce}" src="${res('dist', 'webview', 'main.js')}"></script>
</body>
</html>`;
  }
}
