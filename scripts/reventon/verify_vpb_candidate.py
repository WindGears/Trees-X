"""Reload verification for geometry, per-object bindings and packed images."""
from pathlib import Path
import hashlib
import json
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-candidate.blend'
build = json.loads((OUT / 'vpb-candidate.json').read_text(encoding='utf-8'))
digest = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
assert digest == build['blendSha256']
assert hashlib.sha256((OUT / 'source/vpb-graph.json').read_bytes()).hexdigest() == build['graphSha256']
assert hashlib.sha256((OUT / 'source/vpb-arrays.npz').read_bytes()).hexdigest() == build['arraysSha256']
graph = json.loads((OUT / 'source/vpb-graph.json').read_text(encoding='utf-8'))
records = {r['id']: r for r in graph['records']}
source = np.load(OUT / 'source/vpb-arrays.npz')
objects = list(bpy.data.collections['VPB / Source-bound look candidate'].all_objects)
assert len(objects) == build['objects']
total_vertices = total_triangles = 0
for obj in objects:
    fields = records[obj['source_vpb_geometry']]['fields']
    assert fields['material'] == obj['source_vpb_material'] == obj.data.materials[0]['source_vpb_material_id']
    positions = np.empty((len(obj.data.vertices), 3), dtype='float32')
    obj.data.vertices.foreach_get('co', positions.ravel())
    assert np.array_equal(positions, source[str(fields['positions'])])
    indices = np.empty(len(obj.data.loops), dtype='int32')
    obj.data.loops.foreach_get('vertex_index', indices)
    uv = np.empty((len(indices), 2), dtype='float32')
    obj.data.uv_layers['VPB UV'].data.foreach_get('uv', uv.ravel())
    assert np.array_equal(uv, source[str(fields['texCoords'])][indices])
    assert obj.data.has_custom_normals and np.isfinite(np.array(obj.matrix_world)).all()
    assert len(obj.data.polygons) * 3 == len(indices)
    total_vertices += len(positions)
    total_triangles += len(obj.data.polygons)
    for node in obj.data.materials[0].node_tree.nodes:
        if node.type == 'TEX_IMAGE':
            assert node.image.packed_file and node.image.get('source_pixel_sha256')
assert total_vertices == build['vertices'] and total_triangles == build['triangles']
assert bpy.data.collections['Reventon / Original Geometry'].hide_render
assert bpy.data.collections['Restoration / original wordmark decals'].hide_render
assert not any(marker.camera for marker in bpy.context.scene.timeline_markers)
report = {'result': 'PASS', 'blendSha256': digest, 'objects': len(objects), 'vertices': total_vertices,
          'triangles': total_triangles, 'materialIds': build['materials'],
          'checks': ['saved source vertices exact', 'saved source UV per corner exact', 'source material identity',
                     'custom normals present', 'finite transforms', 'packed image provenance', 'old geometry hidden'],
          'notVerified': ['pixel equivalence to original VRED', 'animation with replacement geometry', 'normal bit equivalence']}
(OUT / 'vpb-candidate-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('VPB_CANDIDATE_VERIFIED', json.dumps(report))
