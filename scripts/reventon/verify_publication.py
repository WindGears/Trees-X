"""Verify published hashes and prove provenance annotation kept compressed pixels."""
from collections import Counter
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote
from raster_origin import with_origin

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public/models/reventon'
EXPORT = ROOT / 'artifacts/reventon/realtime/export'


def png_chunks(data):
    cursor = 8
    chunks = []
    while cursor < len(data):
        length = int.from_bytes(data[cursor:cursor + 4], 'big')
        end = cursor + length + 12
        if data[cursor + 4:cursor + 8] != b'tEXt':
            chunks.append(data[cursor:end])
        cursor = end
    return b''.join(chunks)


report = json.loads((PUBLIC / 'provenance.json').read_text(encoding='utf-8'))
export = json.loads((EXPORT / 'reventon.gltf').read_text(encoding='utf-8'))
sources = {}
for image in export['images']:
    path = EXPORT / unquote(image['uri'])
    sources[hashlib.sha256(path.read_bytes()).hexdigest()] = path
for row in report['resources'] + report['files']:
    raw = (PUBLIC / row['file']).read_bytes()
    assert len(raw) == row['bytes'], row['file']
    assert hashlib.sha256(raw).hexdigest() == row['sha256'], row['file']
    if 'exportSha256' in row:
        source = sources[row['exportSha256']].read_bytes()
        assert png_chunks(source) == png_chunks(raw), row['file']
        assert source[24] == raw[24] == row['pngBitDepth']
        marked = with_origin(raw, 'Origin: provenance replacement check')
        assert marked.count(b'impeccable:prompt\0') == 1
        assert png_chunks(marked) == png_chunks(source)
cover = (PUBLIC / 'reference.jpg').read_bytes()
source_cover = (ROOT / 'lamborghini-reventon-re-made-1.snapshot.2/6-beauty.jpg').read_bytes()
segment_length = int.from_bytes(cover[4:6], 'big')
assert cover[:2] + cover[4 + segment_length:] == source_cover
assert sum(row['bytes'] for row in report['resources'] + report['files']) == report['publishedBytes']
result = {'publishedHashes': len(report['resources'] + report['files']),
          'unchangedPngCompressedPixels': len(report['resources']),
          'pngBitDepthCounts': dict(Counter(row['pngBitDepth'] for row in report['resources'])),
          'unchangedJpegCompressedPixels': True, 'publishedBytes': report['publishedBytes']}
(ROOT / 'artifacts/reventon/realtime/publication-verification.json').write_text(
    json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))
