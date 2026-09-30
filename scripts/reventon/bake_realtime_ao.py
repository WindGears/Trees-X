"""Bake stable self-occlusion in eight independent rigid assemblies.

Only opaque geometry casts AO. Glass, alpha-cut surfaces and other moving
assemblies are excluded, so doors cannot leave permanent shadows on the body.
"""
from pathlib import Path
import collections
import hashlib
import json
import math
import time
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/realtime/ao'
OUT.mkdir(exist_ok=True)
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
source_sha = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
scene = bpy.context.scene
scene.frame_set(1)
source = bpy.data.collections['VPB / Source-bound look candidate']
groups = collections.defaultdict(list)
for obj in source.objects:
    groups[obj.parent.name if obj.parent else 'Body / fixed'].append(obj)
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.hide_render = True
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = False
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'OPTIX'
preferences.get_devices()
for device in preferences.devices:
    device.use = device.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.render.bake.use_selected_to_active = False
scene.render.bake.use_clear = True
scene.render.bake.margin = 16
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '16'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def opaque(obj):
    shader = next(n for n in obj.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    return shader.inputs['Transmission Weight'].default_value < .01 and not shader.inputs['Alpha'].is_linked and shader.inputs['Alpha'].default_value >= .999


for name, members in groups.items():
    group_id = 'fixed' if name == 'Body / fixed' else name.lower().replace('motion / ', '').replace(' ', '_')
    directory = OUT / group_id
    directory.mkdir(exist_ok=True)
    if (directory / 'manifest.json').exists():
        print('AO_REUSE', group_id, flush=True)
        continue
    solids = [obj for obj in members if opaque(obj)]
    for obj in solids:
        uv = obj.data.uv_layers.new(name='Realtime AO')
        obj.data.uv_layers.active = uv
        uv.active_render = True
    select(solids)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    arrays = {}
    records = []
    copies = []
    for index, obj in enumerate(solids):
        uv = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
        obj.data.uv_layers['Realtime AO'].data.foreach_get('uv', uv)
        arrays[str(index)] = uv.reshape((-1, 2))
        records.append({'name': obj.name, 'array': str(index)})
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        source.objects.link(duplicate)
        duplicate.hide_render = False
        copies.append(duplicate)
    np.savez_compressed(directory / 'uv.npz', **arrays)
    select(copies)
    bpy.ops.object.join()
    target = bpy.context.object
    material = bpy.data.materials.new('AO / ' + group_id)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeEmission')
    ao = nodes.new('ShaderNodeAmbientOcclusion')
    ao.inputs['Distance'].default_value = .15
    ao.samples = 64
    links.new(ao.outputs['Color'], emission.inputs['Color'])
    links.new(emission.outputs[0], output.inputs['Surface'])
    target.data.materials.clear()
    target.data.materials.append(material)
    for polygon in target.data.polygons:
        polygon.material_index = 0
    size = 8192 if group_id == 'fixed' else 4096
    image = bpy.data.images.new('AO / ' + group_id, width=size, height=size, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    image_node = nodes.new('ShaderNodeTexImage')
    image_node.image = image
    nodes.active = image_node
    print('AO_START', group_id, len(solids), size, flush=True)
    start = time.time()
    bpy.ops.object.bake(type='EMIT', uv_layer='Realtime AO')
    path = directory / 'occlusion.png'
    image.save_render(str(path), scene=scene)
    report = {'sourceSha256': source_sha, 'group': group_id, 'objects': records,
              'excludedTransparentObjects': len(members) - len(solids), 'size': size,
              'occluders': len(solids), 'otherMovingGroupsIncluded': False, 'distance': .15,
              'seconds': round(time.time() - start, 2), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (directory / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    mesh = target.data
    bpy.data.objects.remove(target, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(material)
    bpy.data.images.remove(image)
    print('AO_DONE', group_id, report['seconds'], flush=True)
print('AO_COMPLETE', flush=True)
