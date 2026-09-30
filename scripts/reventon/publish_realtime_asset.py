"""Package geometry as GLB with same-origin, deduplicated external baked maps."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
from urllib.parse import unquote
from raster_origin import with_origin

TEXTURE_ORIGIN = ('Origin: User supplied Reventon VPB geometry and recovered embedded textures, '
                  'Blender Cycles PBR or rigid-group AO bake. See public/models/reventon/provenance.json '
                  'for source hashes and conversion scope. No generative imagery.')
COVER_ORIGIN = ('Origin: User supplied lamborghini-reventon-re-made-1.snapshot.2/6-beauty.jpg. '
                'Original offline beauty reference used as a catalog cover, not a screenshot of the '
                'Three.js demo. Redistribution license not supplied.')

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts/reventon/realtime'
EXPORT = SOURCE / 'export'
PUBLIC = ROOT / 'public/models/reventon'
PUBLIC.mkdir(parents=True, exist_ok=True)
document = json.loads((EXPORT / 'reventon.gltf').read_text(encoding='utf-8'))
audit = json.loads((SOURCE / 'duplicate-face-audit.json').read_text())
source_manifest = json.loads((SOURCE / 'asset-manifest.json').read_text())
expected = {row['name']: row['triangles'] for row in source_manifest['batches']}
triangles = 0
for mesh in document['meshes']:
    count = sum(document['accessors'][p['indices']]['count'] // 3 for p in mesh['primitives'])
    assert expected[mesh['name']] - count == audit['byBatch'].get(mesh['name'], 0)
    triangles += count
assert triangles == 1500363 and audit['duplicates'] == 207
assert len(document['buffers']) == 1
binary = (EXPORT / unquote(document['buffers'][0].pop('uri'))).read_bytes()
assert len(binary) == document['buffers'][0]['byteLength']
image_indices = {}
images = []
hashes = {}
resources = []
for index, original in enumerate(document.get('images', [])):
    path = (EXPORT / unquote(original['uri'])).resolve()
    assert path.is_relative_to(EXPORT.resolve())
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest not in hashes:
        name = 'texture-' + digest[:20] + path.suffix
        published = with_origin(raw, TEXTURE_ORIGIN)
        (PUBLIC / name).write_bytes(published)
        hashes[digest] = len(images)
        images.append({'uri': name, 'name': original.get('name', path.stem)})
        resources.append({'file': name, 'bytes': len(published),
                          'sha256': hashlib.sha256(published).hexdigest(),
                          'exportSha256': digest, 'exportBytes': len(raw),
                          'pngBitDepth': raw[24]})
    image_indices[index] = hashes[digest]
document['images'] = images
for texture in document.get('textures', []):
    if 'source' in texture:
        texture['source'] = image_indices[texture['source']]
encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
encoded += b' ' * (-len(encoded) % 4)
binary += b'\x00' * (-len(binary) % 4)
with (PUBLIC / 'reventon.glb').open('wb') as handle:
    handle.write(struct.pack('<III', 0x46546c67, 2, 12 + 8 + len(encoded) + 8 + len(binary)))
    handle.write(struct.pack('<II', len(encoded), 0x4e4f534a))
    handle.write(encoded)
    handle.write(struct.pack('<II', len(binary), 0x004e4942))
    handle.write(binary)
motion = json.loads((EXPORT / 'motion.json').read_text(encoding='utf-8'))
(PUBLIC / 'motion.json').write_text(json.dumps(motion, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
shutil.copy2(ROOT / 'artifacts/reventon/textures/studio-recovered.exr', PUBLIC / 'studio.exr')
cover_path = ROOT / 'lamborghini-reventon-re-made-1.snapshot.2/6-beauty.jpg'
(PUBLIC / 'reference.jpg').write_bytes(with_origin(cover_path.read_bytes(), COVER_ORIGIN))
assert sum(n.get('extras', {}).get('source_object_count', 0) for n in document['nodes']) == 2998
assert len([n for n in document['nodes'] if 'reventon_motion_id' in n.get('extras', {})]) == 7
report = {'engine': 'Three.js', 'triangles': triangles, 'sourceTriangles': 1500570,
          'exporterRemovedDuplicateFaces': audit['duplicates'], 'originalObjects': 2998,
          'meshes': len(document['meshes']), 'materials': len(document['materials']),
          'imagesBeforeDeduplication': len(image_indices), 'images': len(images),
          'resources': resources, 'geometryBytes': (PUBLIC / 'reventon.glb').stat().st_size,
          'browserQualityApproved': False,
          'source': 'User-supplied VPB / original embedded imagery; no redistribution license supplied',
          'referenceCover': 'Original user-supplied beauty JPG, not a screenshot of the realtime build',
          'baking': 'Blender Cycles PBR channels and independent rigid-group AO; no video or frame sequence'}
report['files'] = [{'file': name, 'bytes': (PUBLIC / name).stat().st_size,
                    'sha256': hashlib.sha256((PUBLIC / name).read_bytes()).hexdigest()}
                   for name in ('reventon.glb', 'motion.json', 'studio.exr', 'reference.jpg')]
report['sourceFiles'] = [{'file': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                        for path in (ROOT / 'lamborghini-reventon-re-made-1.snapshot.2/2 TEMP.vpb',
                                     ROOT / 'artifacts/reventon/reventon-vpb-film.blend', cover_path)]
report['publishedBytes'] = sum(row['bytes'] for row in resources + report['files'])
report['rasterMetadata'] = 'Lossless provenance chunks; PNG IDAT and JPEG compressed image data unchanged'
(PUBLIC / 'provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(SOURCE / 'publication.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('REALTIME_PUBLISHED', json.dumps({k: v for k, v in report.items() if k != 'resources'}, ensure_ascii=True))
