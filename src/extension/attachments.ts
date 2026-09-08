// Stores pasted / dropped images next to the note.
import * as vscode from 'vscode';
import * as path from 'node:path';

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const mimeExt: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export interface SavedAttachment {
  /** Path relative to the document folder (POSIX). */
  relPath: string;
  /** File name (for wikilinks). */
  name: string;
  uri: vscode.Uri;
}

export async function saveAttachment(docUri: vscode.Uri, folder: string, originalName: string, mime: string, base64: string): Promise<SavedAttachment> {
  const docDir = path.dirname(docUri.fsPath);
  const targetDir = folder ? path.resolve(docDir, folder) : docDir;
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));

  let ext = path.extname(originalName).replace(/^\./, '').toLowerCase();
  if (!ext) ext = mimeExt[mime] ?? 'png';
  const generic = !originalName || /^(image|blob|clipboard|screenshot|pasted[ _-]?image)?\.?\w*$/i.test(path.basename(originalName, path.extname(originalName)));
  const base = generic ? `Pasted image ${timestamp()}` : path.basename(originalName, path.extname(originalName));

  let name = `${base}.${ext}`;
  let fileUri = vscode.Uri.file(path.join(targetDir, name));
  for (let i = 1; i < 1000; i++) {
    try {
      await vscode.workspace.fs.stat(fileUri);
      name = `${base} ${i}.${ext}`;
      fileUri = vscode.Uri.file(path.join(targetDir, name));
    } catch {
      break;
    }
  }
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(base64, 'base64'));
  const relPath = path.relative(docDir, fileUri.fsPath).split(path.sep).join('/');
  return { relPath, name, uri: fileUri };
}
