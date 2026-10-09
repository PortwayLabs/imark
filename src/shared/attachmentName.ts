// Naming of pasted / dropped attachments. Pure helpers (no Node / VS Code
// imports) so they can be unit tested; mirrored in the Sublime Text package
// (sublime/iMark/imark_lib/sync.py) — keep both in sync.

/**
 * Clipboard-style names that carry no information: "image", "image1",
 * "image 2", "blob", "clipboard", "screenshot 2024-01-01", "Pasted image
 * 20240101", or an empty stem. Real file names ("diagram", "logo2",
 * "architecture-v2") are kept.
 */
export const GENERIC_ATTACHMENT_NAME = /^(?:image|blob|clipboard|screenshot|pasted[ _-]?image)?(?:[ _.-]*\d+)*[ _.-]*$/i;

const mimeExt: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/**
 * Split "dir/name.ext" into the stem and the lower-cased extension (without the
 * dot). Unlike path.extname, a leading-dot-only name (".png") is an extension
 * with an empty stem: attachments are never dotfiles.
 */
export function splitAttachmentName(name: string): { stem: string; ext: string } {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  if (dot < 0) return { stem: base, ext: '' };
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
}

export function isGenericAttachmentName(originalName: string): boolean {
  if (!originalName) return true;
  return GENERIC_ATTACHMENT_NAME.test(splitAttachmentName(originalName).stem.trim());
}

export function attachmentTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Base name (without extension) and extension for a new attachment: generic
 * names become "Pasted image <timestamp>", real names are kept; the extension
 * comes from the name, else from the MIME type, else "png".
 */
export function attachmentBaseName(originalName: string, mime: string, now = new Date()): { base: string; ext: string } {
  const { stem, ext: nameExt } = splitAttachmentName(originalName || '');
  const ext = nameExt || mimeExt[mime] || 'png';
  const base = isGenericAttachmentName(originalName) ? `Pasted image ${attachmentTimestamp(now)}` : stem;
  return { base, ext };
}
