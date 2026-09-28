"""Read the supplied VPB's chunked DEFLATE container; never execute embedded data.

This exposes OpenSG metadata for asset recovery, not a VRED scene interpreter.
"""
from pathlib import Path
import json
import mmap
import re
import struct
import zlib

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'lamborghini-reventon-re-made-1.snapshot.2/2 TEMP.vpb'
TARGET = ROOT / 'artifacts/reventon/source/vpb-decoded.osb'
blocks = []
with SOURCE.open('rb') as source, TARGET.open('wb') as target:
    if source.read(4) != bytes.fromhex('44 33 22 11'):
        raise RuntimeError('Unexpected container magic')
    while header := source.read(12):
        if len(header) != 12:
            raise RuntimeError('Incomplete chunk header')
        kind, raw_size, compressed_size = struct.unpack('<III', header)
        if (kind, raw_size, compressed_size) == (0, 0, 0):
            if source.read(1):
                raise RuntimeError('Unexpected data after container terminator')
            break
        if kind != 2 or not 0 < raw_size <= 16 * 1024 * 1024 or compressed_size > 32 * 1024 * 1024:
            raise RuntimeError(f'Unsupported chunk {len(blocks)}: {kind,raw_size,compressed_size}')
        compressed = source.read(compressed_size)
        decoder = zlib.decompressobj(-15)
        decoded = decoder.decompress(compressed, raw_size + 1)
        if len(decoded) != raw_size or not decoder.eof or decoder.unused_data:
            raise RuntimeError('Chunk validation failed')
        target.write(decoded)
        blocks.append({'raw':raw_size,'compressed':compressed_size})
report = {'blocks':len(blocks),'decodedBytes':TARGET.stat().st_size,'references':[]}
with TARGET.open('rb') as stream:
    data = mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
    for match in re.finditer(rb'\.(?:png|jpg|jpeg|hdr|exr|tga|dds|bmp)\x00',data,re.I):
        start = match.start()
        while start > max(0,match.start()-400) and 32 <= data[start-1] <= 126:
            start -= 1
        value = data[start:match.end()-1].decode('ascii')
        if value not in report['references']:
            report['references'].append(value)
    for token in (b'Image\x00',b'pixelFormat\x00',b'pixel\x00',b'width\x00',b'height\x00',b'\x89PNG\r\n\x1a\n'):
        found = data.find(token)
        print(repr(token),found, repr(data[max(0,found-20):found+250]) if found>=0 else '')
    data.close()
(TARGET.parent / 'vpb-inspection.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
