// Stores pasted / dropped images next to the note.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { attachmentBaseName } from '../shared/attachmentName';

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

  // Clipboard-style names ("image.png", "blob", "screenshot 1", …) get a
  // timestamp name; real file names are kept and de-duplicated with " 1", " 2".
  const { base, ext } = attachmentBaseName(originalName, mime);

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
