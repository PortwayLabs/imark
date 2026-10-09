import { describe, expect, it } from 'vitest';
import { attachmentBaseName, attachmentTimestamp, isGenericAttachmentName, splitAttachmentName } from '../../src/shared/attachmentName';

describe('isGenericAttachmentName', () => {
  it('treats clipboard-style names as generic', () => {
    for (const n of ['', 'image.png', 'Image.PNG', 'image1.png', 'image 2.png', 'image.1.png', 'blob', 'clipboard.png', 'Clipboard-2.png', 'screenshot.png', 'Screenshot 2024-01-01.png', 'Pasted image 20240101120000.png', 'pasted_image.png', '.png', '123.png']) {
      expect(isGenericAttachmentName(n), n).toBe(true);
    }
  });
  it('keeps real file names', () => {
    for (const n of ['diagram.png', 'logo2.png', 'architecture.svg', 'architecture-v2.png', 'my diagram.png', 'Screenshot 2024-01-01 at 10.30.00.png', 'imagery.png', 'blobfish.jpg']) {
      expect(isGenericAttachmentName(n), n).toBe(false);
    }
  });
});

describe('attachmentBaseName', () => {
  const now = new Date(2026, 8, 8, 9, 5, 7);
  it('uses a timestamp for generic names and the MIME type for a missing extension', () => {
    expect(attachmentTimestamp(now)).toBe('20260908090507');
    expect(attachmentBaseName('image.png', 'image/png', now)).toEqual({ base: 'Pasted image 20260908090507', ext: 'png' });
    expect(attachmentBaseName('', 'image/jpeg', now)).toEqual({ base: 'Pasted image 20260908090507', ext: 'jpg' });
    expect(attachmentBaseName('blob', 'application/octet-stream', now).ext).toBe('png');
  });
  it('keeps real names and their extension', () => {
    expect(attachmentBaseName('diagram.svg', 'image/svg+xml', now)).toEqual({ base: 'diagram', ext: 'svg' });
    expect(attachmentBaseName('sub/dir/Logo2.PNG', 'image/png', now)).toEqual({ base: 'Logo2', ext: 'png' });
  });
  it('splits names', () => {
    expect(splitAttachmentName('a/b/c.tar.gz')).toEqual({ stem: 'c.tar', ext: 'gz' });
    expect(splitAttachmentName('.png')).toEqual({ stem: '', ext: 'png' });
    expect(splitAttachmentName('noext')).toEqual({ stem: 'noext', ext: '' });
  });
});
