"""Minimal RFC 6455 WebSocket server side (text frames, ping/pong, close,
fragmentation) on top of a socket / buffered file pair. Standard library only so
it runs inside Sublime Text's plugin host."""
import base64
import hashlib
import struct
import threading

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

OP_CONTINUATION = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

MAX_MESSAGE = 64 * 1024 * 1024


class WebSocketError(Exception):
    pass


def accept_key(client_key):
    digest = hashlib.sha1((client_key.strip() + GUID).encode('ascii')).digest()
    return base64.b64encode(digest).decode('ascii')


def encode_frame(opcode, payload=b'', fin=True):
    """Build an unmasked (server → client) frame."""
    if isinstance(payload, str):
        payload = payload.encode('utf-8')
    head = bytearray()
    head.append((0x80 if fin else 0) | (opcode & 0x0F))
    n = len(payload)
    if n < 126:
        head.append(n)
    elif n < 65536:
        head.append(126)
        head += struct.pack('!H', n)
    else:
        head.append(127)
        head += struct.pack('!Q', n)
    return bytes(head) + payload


def _read_exact(rfile, n):
    buf = b''
    while len(buf) < n:
        chunk = rfile.read(n - len(buf))
        if not chunk:
            raise WebSocketError('connection closed')
        buf += chunk
    return buf


def read_frame(rfile):
    """Read one (possibly masked) frame → ``(fin, opcode, payload)``."""
    b1, b2 = _read_exact(rfile, 2)
    fin = bool(b1 & 0x80)
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        (length,) = struct.unpack('!H', _read_exact(rfile, 2))
    elif length == 127:
        (length,) = struct.unpack('!Q', _read_exact(rfile, 8))
    if length > MAX_MESSAGE:
        raise WebSocketError('frame too large')
    mask = _read_exact(rfile, 4) if masked else None
    payload = _read_exact(rfile, length) if length else b''
    if mask:
        payload = unmask(payload, mask)
    return fin, opcode, payload


def unmask(payload, mask):
    # XOR in 8-byte blocks via int arithmetic: fast enough for editor traffic.
    if not payload:
        return payload
    n = len(payload)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(payload, 'little') ^ int.from_bytes(key, 'little')).to_bytes(n, 'little')


class WebSocket:
    """A connected WebSocket. ``send_text`` is thread-safe; ``messages`` is a
    generator to be consumed by the connection's own thread."""

    def __init__(self, sock, rfile, wfile):
        self.sock = sock
        self.rfile = rfile
        self.wfile = wfile
        self.open = True
        self._lock = threading.Lock()

    def _write(self, data):
        with self._lock:
            if not self.open:
                raise WebSocketError('socket closed')
            self.wfile.write(data)
            self.wfile.flush()

    def send_text(self, text):
        self._write(encode_frame(OP_TEXT, text))

    def send_pong(self, payload=b''):
        self._write(encode_frame(OP_PONG, payload))

    def send_close(self, code=1000, reason=''):
        try:
            self._write(encode_frame(OP_CLOSE, struct.pack('!H', code) + reason.encode('utf-8')))
        except Exception:  # pylint: disable=broad-except
            pass

    def close(self):
        with self._lock:
            if not self.open:
                return
            self.open = False
        try:
            self.sock.shutdown(2)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass

    def messages(self):
        """Yield complete text messages until the connection closes."""
        fragments = []
        frag_opcode = None
        try:
            while self.open:
                fin, opcode, payload = read_frame(self.rfile)
                if opcode == OP_CLOSE:
                    self.send_close()
                    break
                if opcode == OP_PING:
                    self.send_pong(payload)
                    continue
                if opcode == OP_PONG:
                    continue
                if opcode in (OP_TEXT, OP_BINARY):
                    if fragments:
                        raise WebSocketError('new message while fragmented message pending')
                    if fin:
                        if opcode == OP_TEXT:
                            yield payload.decode('utf-8')
                        continue
                    frag_opcode = opcode
                    fragments.append(payload)
                    continue
                if opcode == OP_CONTINUATION:
                    if not fragments:
                        raise WebSocketError('continuation without start')
                    fragments.append(payload)
                    if sum(len(f) for f in fragments) > MAX_MESSAGE:
                        raise WebSocketError('message too large')
                    if fin:
                        data = b''.join(fragments)
                        fragments = []
                        if frag_opcode == OP_TEXT:
                            yield data.decode('utf-8')
                    continue
                raise WebSocketError('unsupported opcode %d' % opcode)
        except (WebSocketError, OSError, ValueError):
            pass
        finally:
            self.close()
