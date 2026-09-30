"""Assemble original geometry, baked PBR, rigid-group AO, and sampled motion.

This exports real geometry and transforms. No rendered frames are used at runtime.
"""
from pathlib import Path
import collections
import hashlib
import json
import math
import sys
import time
import bpy
import numpy as np
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/realtime'
EXPORT = OUT / 'export'
EXPORT.mkdir(exist_ok=True)
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
scene = bpy.context.scene
scene.frame_set(1)
source = bpy.data.collections['VPB / Source-bound look candidate']
objects = list(source.objects)
source_sha = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
groups = collections.defaultdict(list)
for obj in objects:
    groups[obj.parent.name if obj.parent else 'Body / fixed'].append(obj)
group_ids = {name: 'fixed' if name == 'Body / fixed' else name.lower().replace('motion / ', '').replace(' ', '_') for name in groups}
controls = [bpy.data.objects[name] for name in groups if name != 'Body / fixed']


def select(items):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in items:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = items[0]


def load_image(path, color_space):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = color_space
    return image


materials = {}
for identifier in sorted({o['source_vpb_material'] for o in objects}):
    directory = OUT / 'materials' / str(identifier)
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['sourceSha256'] == source_sha
    arrays = np.load(directory / 'uv.npz')
    for record in manifest['objects']:
        obj = bpy.data.objects[record['name']]
        layer = obj.data.uv_layers.new(name='Realtime Bake')
        layer.data.foreach_set('uv', arrays[record['array']].ravel())
        layer.active_render = True
    material = bpy.data.materials['RX / VPB ' + str(identifier)]
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(shader.outputs[0], output.inputs['Surface'])
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'Realtime Bake'
    for name, value in manifest['constants'].items():
        shader.inputs[name].default_value = value
    for name, record in manifest['channels'].items():
        node = nodes.new('ShaderNodeTexImage')
        node.image = load_image(OUT / record['file'], record['colorSpace'])
        links.new(uv.outputs['UV'], node.inputs['Vector'])
        socket = node.outputs['Color']
        if name == 'Normal':
            normal = nodes.new('ShaderNodeNormalMap')
            normal.uv_map = 'Realtime Bake'
            links.new(socket, normal.inputs['Color'])
            socket = normal.outputs['Normal']
        links.new(socket, shader.inputs[name])
    material['realtime_baked'] = True
    materials[identifier] = material
print('PBR_ASSEMBLED', len(materials), flush=True)

# Apply independently checkpointed AO, preserving original per-object UV correspondence.
ao_group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
ao_group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
ao_records = []
for name, members in groups.items():
    group_id = group_ids[name]
    directory = OUT / 'ao' / group_id
    report = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    assert report['sourceSha256'] == source_sha and report['otherMovingGroupsIncluded'] is False
    assert hashlib.sha256((directory / 'occlusion.png').read_bytes()).hexdigest() == report['sha256']
    arrays = np.load(directory / 'uv.npz')
    receivers = {row['name'] for row in report['objects']}
    for row in report['objects']:
        obj = bpy.data.objects[row['name']]
        layer = obj.data.uv_layers.new(name='Realtime AO')
        layer.data.foreach_set('uv', arrays[row['array']].ravel())
    image = load_image(directory / 'occlusion.png', 'Non-Color')
    scoped = {}
    for obj in members:
        identifier = obj['source_vpb_material']
        if identifier not in scoped:
            mat = materials[identifier].copy()
            mat.name = f'Reventon / {group_id} / {identifier}'
            mat['reventon_group'] = group_id
            if obj.name in receivers:
                nodes, links = mat.node_tree.nodes, mat.node_tree.links
                uv = nodes.new('ShaderNodeUVMap')
                uv.uv_map = 'Realtime AO'
                texture = nodes.new('ShaderNodeTexImage')
                texture.image = image
                links.new(uv.outputs['UV'], texture.inputs['Vector'])
                output = nodes.new('ShaderNodeGroup')
                output.node_tree = ao_group
                links.new(texture.outputs['Color'], output.inputs['Occlusion'])
            scoped[identifier] = mat
        obj.data.materials[0] = scoped[identifier]
    ao_records.append({k: v for k, v in report.items() if k != 'objects'})

# Merge draw objects by rigid assembly and material; never decimate original faces.
batches = collections.defaultdict(list)
for obj in objects:
    batches[(obj.parent.name if obj.parent else 'Body / fixed', obj['source_vpb_material'])].append(obj)
before = sum(len(o.data.polygons) for o in objects)
batch_records = []
merged = []
for (group_name, identifier), members in batches.items():
    node_ids = [int(o['source_vpb_node']) for o in members]
    expected = sum(len(o.data.polygons) for o in members)
    select(members)
    if len(members) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    assert len(obj.data.polygons) == expected
    obj.name = f'{group_ids[group_name]}__{identifier}'
    obj.data.name = obj.name
    obj['source_nodes'] = json.dumps(node_ids)
    obj['source_object_count'] = len(node_ids)
    obj['reventon_group'] = group_ids[group_name]
    obj.hide_render = False
    obj.data.uv_layers.active = obj.data.uv_layers['Realtime Bake']
    obj.data.uv_layers['Realtime Bake'].active_render = True
    batch_records.append({'name': obj.name, 'sourceNodes': node_ids, 'triangles': expected})
    merged.append(obj)
assert sum(len(o.data.polygons) for o in merged) == before == 1500570
assert sum(len(r['sourceNodes']) for r in batch_records) == 2998
print('GEOMETRY_ASSEMBLED', len(merged), before, flush=True)

# Coordinate conversion matches glTF Y-up mesh/node export. Camera basis remains
# camera-local (-Z forward, +Y up), hence only the left conversion for cameras.
convert = Matrix.Rotation(-math.pi / 2, 4, 'X')
inverse = convert.inverted()
tracks = []
for control in controls:
    control['reventon_motion_id'] = group_ids[control.name]
    tracks.append({'id': group_ids[control.name], 'frames': []})
cameras = []
camera_names = ['Motion camera / Opening', 'Motion camera / Cabin', 'Motion camera / Separation']
for frame in range(1, 385):
    scene.frame_set(frame)
    for control, track in zip(controls, tracks):
        p, q, s = (convert @ control.matrix_world @ inverse).decompose()
        track['frames'].append([*p, q.x, q.y, q.z, q.w, *s])
    camera = bpy.data.objects[camera_names[0 if frame < 97 else 1 if frame < 193 else 2]]
    p, q, _ = (convert @ camera.matrix_world).decompose()
    # Source camera's horizontal FOV is preserved across viewport aspect ratios.
    cameras.append({'position': list(p), 'quaternion': [q.x, q.y, q.z, q.w],
                    'horizontalFov': math.degrees(2 * math.atan(camera.data.sensor_width / (2 * camera.data.lens)))})
scene.frame_set(1)
motion = {'fps': 24, 'frames': 384, 'duration': 383 / 24, 'tracks': tracks, 'cameras': cameras,
          'chapters': [{'id': 'doors', 'label': '开启', 'time': 0}, {'id': 'cabin', 'label': '座舱', 'time': 4},
                       {'id': 'structure', 'label': '展开', 'time': 8}, {'id': 'complete', 'label': '合拢', 'time': 12.5}],
          'sourceSha256': source_sha, 'coordinateSystem': 'glTF Y-up', 'scope': 'Existing parts, not engineering disassembly'}
(EXPORT / 'motion.json').write_text(json.dumps(motion, separators=(',', ':')), encoding='utf-8')
select(merged + controls)
bpy.ops.export_scene.gltf(filepath=str(EXPORT / 'reventon.gltf'), export_format='GLTF_SEPARATE',
                          use_selection=True, export_animations=False, export_extras=True,
                          export_texcoords=True, export_normals=True, export_tangents=True,
                          export_image_format='AUTO', export_yup=True)
report = {'sourceSha256': source_sha, 'originalObjects': 2998, 'triangles': before,
          'batches': batch_records, 'motionGroups': 7, 'bakedAO': ao_records,
          'browserQualityApproved': False, 'status': 'REALTIME_ASSET_EXPORTED_PENDING_BROWSER_REVIEW'}
(OUT / 'asset-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'reventon-realtime.blend'), compress=True)
print('REALTIME_ASSET_READY', len(merged), before, flush=True)
