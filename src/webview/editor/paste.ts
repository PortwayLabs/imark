// Image paste / drop: send the bytes to the extension host, which stores them in
// the attachments folder, then insert a link at the cursor.
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { AttachmentSavedMessage, LinkStyle } from '../../shared/protocol';
import { host } from '../host';
import { encodePath } from '../links';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function linkFor(msg: AttachmentSavedMessage, style: LinkStyle): string {
  if (style === 'wikilink') return `![[${msg.name}]]`;
  return `![](${encodePath(msg.relPath)})`;
}

async function insertFiles(view: EditorView, files: File[], style: () => LinkStyle, pos: number): Promise<void> {
  const images = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name));
  if (!images.length) return;
  const placeholder = `![Uploading ${images.length > 1 ? images.length + ' images' : images[0].name || 'image'}…]()`;
  view.dispatch({ changes: { from: pos, insert: placeholder } });
  const links: string[] = [];
  for (const file of images) {
    try {
      const data = await fileToBase64(file);
      const reply = await host.request<AttachmentSavedMessage>((id) => ({
        type: 'saveAttachment',
        id,
        name: file.name,
        mime: file.type,
        data,
      }));
      if (reply.error) {
        host.post({ type: 'notify', level: 'error', message: `Could not save image: ${reply.error}` });
        continue;
      }
      links.push(linkFor(reply, style()));
    } catch (e) {
      host.post({ type: 'notify', level: 'error', message: `Could not save image: ${String(e)}` });
    }
  }
  // Replace the placeholder wherever it ended up.
  const text = view.state.doc.toString();
  const idx = text.indexOf(placeholder);
  const insert = links.join('\n');
  if (idx >= 0) {
    view.dispatch({ changes: { from: idx, to: idx + placeholder.length, insert }, selection: { anchor: idx + insert.length } });
  } else {
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length } });
  }
}

export function imagePaste(style: () => LinkStyle): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return false;
      const hasText = !!event.clipboardData?.getData('text/plain');
      if (hasText && !files.some((f) => /^image\//.test(f.type))) return false;
      event.preventDefault();
      void insertFiles(view, files, style, view.state.selection.main.head);
      return true;
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void insertFiles(view, files, style, pos);
      return true;
    },
  });
}
