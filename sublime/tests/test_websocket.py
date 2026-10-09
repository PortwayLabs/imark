import io
import os
import struct
import unittest

import _env  # noqa: F401  pylint: disable=unused-import

from iMark.imark_lib import websocket  # noqa: E402


def mask_frame(opcode, payload, fin=True):
    """Client → server frame (masked)."""
    if isinstance(payload, str):
        payload = payload.encode('utf-8')
    head = bytearray([(0x80 if fin else 0) | opcode])
    n = len(payload)
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head.append(0x80 | 126)
        head += struct.pack('!H', n)
    else:
        head.append(0x80 | 127)
        head += struct.pack('!Q', n)
    mask = os.urandom(4)
    return bytes(head) + mask + websocket.unmask(payload, mask)


class FakeSocket:
    def shutdown(self, _how):
        pass

    def close(self):
        pass


class WebSocketTest(unittest.TestCase):
    def test_accept_key_rfc_vector(self):
        self.assertEqual(websocket.accept_key('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')

    def test_encode_frame_lengths(self):
        self.assertEqual(websocket.encode_frame(websocket.OP_TEXT, 'hi')[:2], b'\x81\x02')
        f = websocket.encode_frame(websocket.OP_BINARY, b'x' * 300)
        self.assertEqual(f[1], 126)
        self.assertEqual(struct.unpack('!H', f[2:4])[0], 300)
        f = websocket.encode_frame(websocket.OP_BINARY, b'x' * 70000)
        self.assertEqual(f[1], 127)
        self.assertEqual(struct.unpack('!Q', f[2:10])[0], 70000)

    def test_read_masked_frames_and_fragmentation(self):
        data = mask_frame(websocket.OP_TEXT, 'héllo') + mask_frame(websocket.OP_TEXT, 'x' * 70000)
        data += mask_frame(websocket.OP_TEXT, 'ab', fin=False) + mask_frame(websocket.OP_CONTINUATION, 'cd', fin=True)
        data += mask_frame(websocket.OP_PING, b'p') + mask_frame(websocket.OP_CLOSE, struct.pack('!H', 1000))
        out = io.BytesIO()
        ws = websocket.WebSocket(FakeSocket(), io.BytesIO(data), out)
        messages = list(ws.messages())
        self.assertEqual(messages, ['héllo', 'x' * 70000, 'abcd'])
        self.assertFalse(ws.open)
        written = out.getvalue()
        # a pong echoing the ping payload and a close frame were sent
        self.assertIn(websocket.encode_frame(websocket.OP_PONG, b'p'), written)
        self.assertEqual(written[-4:-2], b'\x88\x02')

    def test_send_text_writes_unmasked_frame(self):
        out = io.BytesIO()
        ws = websocket.WebSocket(FakeSocket(), io.BytesIO(b''), out)
        ws.send_text('{"type":"init"}')
        self.assertEqual(out.getvalue(), b'\x81\x0f{"type":"init"}')
        ws.close()
        with self.assertRaises(websocket.WebSocketError):
            ws.send_text('after close')

    def test_truncated_stream_ends_iteration(self):
        ws = websocket.WebSocket(FakeSocket(), io.BytesIO(b'\x81'), io.BytesIO())
        self.assertEqual(list(ws.messages()), [])


if __name__ == '__main__':
    unittest.main()
