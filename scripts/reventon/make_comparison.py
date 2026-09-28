"""Create a local comparison page only when the saved scene and renders agree."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
report = json.loads((OUT / 'renders/validation-report.json').read_text())
scene = json.loads((OUT / 'scene-verification.json').read_text())
blend_hash = hashlib.sha256((OUT / 'reventon-restored.blend').read_bytes()).hexdigest()
assert scene['result'] == 'PASS'
assert report['blendSha256'] == scene['blendSha256'] == blend_hash, 'Stale render or scene verification'
assert {shot['shot'] for shot in report['shots']} == {'Hero', 'Wheel'}
for shot in report['shots']:
    image_path = ROOT / shot['file']
    assert hashlib.sha256(image_path.read_bytes()).hexdigest() == shot['sha256']
    assert hashlib.sha256((ROOT / shot['linearMaster']).read_bytes()).hexdigest() == shot['masterSha256']
    with Image.open(image_path) as image:
        assert image.size == (3968, 1758)
    source = ROOT / 'lamborghini-reventon-re-made-1.snapshot.2' / ('6-beauty.jpg' if shot['shot'] == 'Hero' else '7-beauty.jpg')
    assert image_path.read_bytes() != source.read_bytes()
template = (Path(__file__).parent / 'comparison.template.html').read_text(encoding='utf-8')
(OUT / 'comparison.html').write_text(template.replace('__REPORT__', json.dumps(report).replace('<', '\\u003c')), encoding='utf-8')
print('Comparison ready: all render/master hashes match the verified Blender scene.')
