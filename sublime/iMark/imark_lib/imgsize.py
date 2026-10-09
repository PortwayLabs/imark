"""Read image dimensions from file headers (PNG, GIF, JPEG - the formats
minihtml can display) without decoding the image."""
import struct

DISPLAYABLE = ('.png', '.jpg', '.jpeg', '.gif')


def image_size(path):
    """``(width, height)`` or ``None``."""
    try:
        with open(path, 'rb') as fh:
            head = fh.read(32)
            if head.startswith(b'\x89PNG\r\n\x1a\n') and head[12:16] == b'IHDR':
                w, h = struct.unpack('>II', head[16:24])
                return int(w), int(h)
            if head[:6] in (b'GIF87a', b'GIF89a'):
                w, h = struct.unpack('<HH', head[6:10])
                return int(w), int(h)
            if head[:2] == b'\xff\xd8':
                fh.seek(2)
                return _jpeg_size(fh)
    except (OSError, struct.error):
        return None
    return None


def _jpeg_size(fh):
    while True:
        marker = fh.read(2)
        if len(marker) < 2 or marker[0] != 0xFF:
            return None
        code = marker[1]
        while code == 0xFF:  # padding
            nxt = fh.read(1)
            if not nxt:
                return None
            code = nxt[0]
        if code in (0xD8, 0x01) or 0xD0 <= code <= 0xD7:
            continue
        length_bytes = fh.read(2)
        if len(length_bytes) < 2:
            return None
        (length,) = struct.unpack('>H', length_bytes)
        if code in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            data = fh.read(5)
            if len(data) < 5:
                return None
            h, w = struct.unpack('>HH', data[1:5])
            return int(w), int(h)
        if code == 0xD9 or code == 0xDA:
            return None
        fh.seek(length - 2, 1)


def fit(width, height, max_width):
    """Scale ``(width, height)`` down to ``max_width`` keeping the aspect ratio."""
    if not width or not height or max_width <= 0 or width <= max_width:
        return width, height
    return max_width, max(1, int(round(height * max_width / float(width))))
