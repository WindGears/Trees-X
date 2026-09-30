"""Embed source provenance without recompressing PNG or JPEG image data."""
import struct
import zlib

KEYWORD = b'impeccable:prompt'


def with_origin(data: bytes, origin: str) -> bytes:
    payload = KEYWORD + b'\0' + origin.encode('ascii')
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        chunks = [data[:8]]
        cursor = 8
        while cursor < len(data):
            length = struct.unpack_from('>I', data, cursor)[0]
            kind = data[cursor + 4:cursor + 8]
            end = cursor + length + 12
            assert end <= len(data), 'Truncated PNG chunk'
            content = data[cursor + 8:cursor + 8 + length]
            if kind == b'IEND':
                chunk = b'tEXt' + payload
                chunks.append(struct.pack('>I', len(payload)) + chunk
                              + struct.pack('>I', zlib.crc32(chunk)))
            if not (kind == b'tEXt' and content.startswith(KEYWORD + b'\0')):
                chunks.append(data[cursor:end])
            cursor = end
        assert kind == b'IEND', 'Missing PNG end'
        return b''.join(chunks)
    if data.startswith(b'\xff\xd8'):
        # Publication always starts with the original source, not a marked copy.
        assert len(payload) + 2 < 65536
        return data[:2] + b'\xff\xfe' + struct.pack('>H', len(payload) + 2) + payload + data[2:]
    raise ValueError('Only PNG and JPEG origins are supported')
