"""Create an isolated look candidate from the actual VPB geometry/material graph.

The earlier Rhino restoration and motion proof are never overwritten. This is
static look development, not a replacement for the validated motion rig.
"""
from pathlib import Path
import hashlib
import json
import sys
import bpy
import numpy as np
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from vpb_cycles_materials import Adapter
from calibrate_vpb_studio import calibrate

assert bpy.app.background
OUT = ROOT / 'artifacts/reventon'
assert Path(bpy.data.filepath).name == 'reventon-motion-proof.blend'
scene = bpy.context.scene
scene.frame_set(1)
# Camera-bound motion markers can override scene.camera when rendering a still.
# This separate candidate is static; the original motion proof keeps its markers.
scene.timeline_markers.clear()
graph = json.loads((OUT / 'source/vpb-graph.json').read_text(encoding='utf-8'))
records = {r['id']: r for r in graph['records']}
arrays = np.load(OUT / 'source/vpb-arrays.npz')
adapter = Adapter(records)
materials, imported, skipped = {}, [], []
collection = bpy.data.collections.new('VPB / Source-bound look candidate')
scene.collection.children.link(collection)
for name in ('Reventon / Original Geometry', 'Restoration / original wordmark decals'):
    bpy.data.collections[name].hide_render = True
    bpy.data.collections[name].hide_viewport = True


def triangles(core):
    fields = core['fields']
    indices = arrays[str(fields['indices'])].astype('int32')
    types = arrays[str(fields['types'])]
    lengths = arrays[str(fields['lengths'])]
    result, cursor = [], 0
    for kind, length in zip(types, lengths):
        part = indices[cursor:cursor + int(length)]
        cursor += int(length)
        if kind == 4:
            result.extend(part.reshape(-1, 3).tolist())
        elif kind == 5:
            result.extend((part[i:i + 3] if i % 2 == 0 else part[[i + 1, i, i + 2]]).tolist() for i in range(len(part) - 2))
        elif kind in (6, 9):
            result.extend([[int(part[0]), int(part[i]), int(part[i + 1])] for i in range(1, len(part) - 1)])
        else:
            raise ValueError(f'Unsupported primitive {kind} in {core["id"]}')
    assert cursor == len(indices)
    faces = np.array(result, dtype='int32')
    return faces[np.logical_and(faces[:, 0] != faces[:, 1], np.logical_and(faces[:, 1] != faces[:, 2], faces[:, 2] != faces[:, 0]))]


def visit(node_id, transform, visible, path):
    node = records[node_id]
    fields = node['fields']
    visible = visible and fields.get('travMask', 0) != 0
    core = records.get(fields['core'])
    names = node.get('names', [])
    path = path + names
    if core and core['type'] == 'Transform3D':
        transform = transform @ Matrix(np.array(core['fields']['matrix']).reshape(4, 4).T.tolist())
    if core and core['type'] == 'Geometry':
        if not visible:
            skipped.append({'node': node_id, 'geometry': core['id'], 'reason': 'hidden in VPB scene graph'})
            return
        geo = core['fields']
        positions = arrays[str(geo['positions'])]
        normals = arrays[str(geo['normals'])]
        uv = arrays[str(geo['texCoords'])]
        assert len(positions) == len(normals) == len(uv)
        assert np.isfinite(positions).all() and np.isfinite(normals).all() and np.isfinite(uv).all()
        faces = triangles(core)
        assert faces.min() >= 0 and faces.max() < len(positions)
        mesh = bpy.data.meshes.new('VPB geometry ' + str(core['id']))
        mesh.vertices.add(len(positions)); mesh.vertices.foreach_set('co', positions.ravel())
        mesh.loops.add(faces.size); mesh.loops.foreach_set('vertex_index', faces.ravel())
        mesh.polygons.add(len(faces))
        mesh.polygons.foreach_set('loop_start', np.arange(0, faces.size, 3, dtype='int32'))
        mesh.polygons.foreach_set('loop_total', np.full(len(faces), 3, dtype='int32'))
        mesh.polygons.foreach_set('use_smooth', np.ones(len(faces), dtype=bool))
        mesh.update()
        mesh.normals_split_custom_set_from_vertices(normals.tolist())
        mesh.uv_layers.new(name='VPB UV').data.foreach_set('uv', uv[faces.ravel()].ravel())
        material_id = geo['material']
        if material_id not in materials:
            materials[material_id] = adapter.make(material_id)
        mesh.materials.append(materials[material_id])
        obj = bpy.data.objects.new('VPB ' + str(node_id) + ' / ' + str(material_id), mesh)
        collection.objects.link(obj)
        local = Matrix(np.array(records[geo['transform']]['fields']['matrix']).reshape(4, 4).T.tolist())
        obj.matrix_world = transform @ local
        obj['source_vpb_node'] = node_id
        obj['source_vpb_geometry'] = core['id']
        obj['source_vpb_material'] = material_id
        obj['source_vpb_path'] = json.dumps(path, ensure_ascii=False)
        imported.append({'node': node_id, 'geometry': core['id'], 'material': material_id,
                         'vertices': len(positions), 'triangles': len(faces), 'path': path})
    for child in fields.get('children', []):
        visit(child, transform, visible, path)


# Source RootNode converts Rhino coordinates to VPB units. Divide the complete
# hierarchy by 256, preserving the original ground translation and transforms.
scale = Matrix.Diagonal((1 / 256, 1 / 256, 1 / 256, 1))
visit(14935, scale, True, [])
scene.camera = bpy.data.objects['Camera / Hero']
calibrate(scene)
scene['quality_gate'] = 'VPB geometry and bindings candidate; reconstructed Cycles shaders; visual approval pending'
scene['candidate_source'] = 'Original VPB graph; prior Rhino geometry remains hidden and unchanged'
target = OUT / 'reventon-vpb-candidate.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=True)
report = {'blend': str(target.relative_to(ROOT)), 'blendSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'graphSha256': hashlib.sha256((OUT / 'source/vpb-graph.json').read_bytes()).hexdigest(),
          'arraysSha256': hashlib.sha256((OUT / 'source/vpb-arrays.npz').read_bytes()).hexdigest(),
          'vertices': sum(r['vertices'] for r in imported), 'triangles': sum(r['triangles'] for r in imported),
          'objects': len(imported), 'materials': sorted(materials), 'imported': imported, 'skipped': skipped,
          'limitations': ['Cycles BSDF reconstruction, not shader equivalence', 'Static candidate; motion rig remains in separate proof',
                          'Planar projector and complete VRED compositing are not yet ported']}
(OUT / 'vpb-candidate.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('VPB_CANDIDATE_COMPLETE', json.dumps({k: v for k, v in report.items() if k not in ('imported', 'skipped')}))
