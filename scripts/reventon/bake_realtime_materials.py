"""Bake source shaders to explicit UV PBR maps, without lighting in base color.

Run in a separate background Blender with reventon-vpb-film.blend loaded.
Each material is checkpointed independently. Original mesh/UV/transforms stay intact.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys
import time
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/realtime'
parser = argparse.ArgumentParser()
parser.add_argument('--ids', default='19691')
parser.add_argument('--size', type=int, default=4096)
parser.add_argument('--proof', action='store_true')
parser.add_argument('--project', action='store_true')
parser.add_argument('--output', default='')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if args.output:
    OUT = OUT / args.output
    OUT.mkdir(exist_ok=True)
assert bpy.app.background
assert Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
source_sha = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
scene = bpy.context.scene
scene.frame_set(1)
source = bpy.data.collections['VPB / Source-bound look candidate']
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'OPTIX'
preferences.get_devices()
for device in preferences.devices:
    device.use = device.type == 'OPTIX'
assert any(d.use for d in preferences.devices), 'No OptiX device'
scene.cycles.device = 'GPU'
scene.render.bake.use_selected_to_active = False
scene.render.bake.cage_extrusion = .0001
scene.render.bake.max_ray_distance = .0003
scene.render.bake.use_clear = True
scene.render.bake.margin = 16
scene.render.bake.normal_space = 'TANGENT'
scene.render.bake.normal_r, scene.render.bake.normal_g, scene.render.bake.normal_b = 'POS_X', 'POS_Y', 'POS_Z'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '16'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def freeze_source_uv(material):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'VPB UV'
    for node in list(nodes):
        if node.type == 'TEX_COORD':
            for link in list(node.outputs['UV'].links):
                links.new(uv.outputs['UV'], link.to_socket)
        elif node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
            links.new(uv.outputs['UV'], node.inputs['Vector'])


def unwrap(objects):
    for obj in objects:
        layer = obj.data.uv_layers.get('Realtime Bake') or obj.data.uv_layers.new(name='Realtime Bake')
        obj.data.uv_layers.active = layer
        layer.active_render = True
    select(objects)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.005,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.005)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_channel(material, shader, objects, channel, directory, size, projection=None):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    original = output.inputs['Surface'].links[0].from_socket
    image = bpy.data.images.new(f'Baked {material.name} / {channel}', width=size, height=size,
                                alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'sRGB' if channel == 'Base Color' else 'Non-Color'
    target_nodes = projection.data.materials[0].node_tree.nodes if projection else nodes
    target = target_nodes.new('ShaderNodeTexImage')
    target.image = image
    temporary = []
    if channel != 'Normal':
        emission = nodes.new('ShaderNodeEmission')
        temporary.append(emission)
        socket = shader.inputs[channel]
        if socket.is_linked:
            links.new(socket.links[0].from_socket, emission.inputs['Color'])
        else:
            value = socket.default_value
            emission.inputs['Color'].default_value = tuple(value) if hasattr(value, '__len__') else (value, value, value, 1)
        links.new(emission.outputs[0], output.inputs['Surface'])
    target_nodes.active = target
    target.select = True
    select(objects)
    if projection:
        projection.select_set(True)
        bpy.context.view_layer.objects.active = projection
    scene.render.bake.use_selected_to_active = bool(projection)
    start = time.time()
    print('BAKE_START', material.name, channel, size, len(objects), flush=True)
    bpy.ops.object.bake(type='NORMAL' if channel == 'Normal' else 'EMIT', uv_layer='Realtime Bake')
    links.new(original, output.inputs['Surface'])
    for node in temporary:
        nodes.remove(node)
    path = directory / (channel.lower().replace(' ', '-') + '.png')
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save_render(str(path), scene=scene)
    values = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    rgba = values.reshape((-1, 4))
    assert np.isfinite(values).all()
    stats = {'min': rgba[:, :3].min(axis=0).tolist(), 'max': rgba[:, :3].max(axis=0).tolist(),
             'mean': rgba[:, :3].mean(axis=0).tolist(), 'seconds': round(time.time() - start, 2),
             'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    target_nodes.remove(target)
    bpy.data.images.remove(image)
    print('BAKE_DONE', material.name, channel, stats, flush=True)
    return {'file': path.relative_to(OUT).as_posix(), 'colorSpace': 'sRGB' if channel == 'Base Color' else 'Non-Color', **stats}


def bake_material(identifier):
    objects = sorted([o for o in source.objects if o.data.materials[0]['source_vpb_material_id'] == identifier], key=lambda o: o.name)
    material = objects[0].data.materials[0]
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    directory = OUT / 'materials' / str(identifier)
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / 'manifest.json').exists() and not args.proof:
        print('BAKE_REUSE', identifier, flush=True)
        return
    # PBR channels are local surface data. Other meshes/lights do not contribute;
    # excluding them also avoids rebuilding the entire car for every atlas island.
    included = set(objects)
    for candidate in bpy.data.objects:
        if candidate.type == 'MESH':
            candidate.hide_render = candidate not in included
    freeze_source_uv(material)
    unwrap(objects)
    arrays = {}
    object_records = []
    for index, obj in enumerate(objects):
        uv = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
        obj.data.uv_layers['Realtime Bake'].data.foreach_get('uv', uv)
        assert np.isfinite(uv).all() and uv.min() >= -1e-5 and uv.max() <= 1.00001
        arrays[str(index)] = uv.reshape((-1, 2))
        obj.data.calc_loop_triangles()
        object_records.append({'name': obj.name, 'array': str(index), 'triangles': len(obj.data.loop_triangles),
                               'group': obj.parent.name if obj.parent else 'Body / fixed'})
    np.savez_compressed(directory / 'uv.npz', **arrays)
    projection = None
    combined = None
    target_material = None
    bake_objects = objects
    if args.project:
        copies = []
        for obj in objects:
            duplicate = obj.copy()
            duplicate.data = obj.data.copy()
            source.objects.link(duplicate)
            duplicate.name = 'Bake target / ' + obj.name
            copies.append(duplicate)
        select(copies)
        bpy.ops.object.join()
        combined = bpy.context.object
        combined.name = 'Bake target / combined'
        object_projection = any(n.type == 'TEX_COORD' and
                                (n.outputs['Object'].is_linked or n.outputs['Generated'].is_linked)
                                for n in material.node_tree.nodes)
        if object_projection:
            projection = combined
            projection.data.materials.clear()
            target_material = bpy.data.materials.new('Bake target material')
            target_material.use_nodes = True
            projection.data.materials.append(target_material)
        else:
            # UV-only graphs and split normals are invariant under a mesh join.
            # Bake this one equivalent surface directly; no projection ray error.
            bake_objects = [combined]
            for obj in objects:
                obj.hide_render = True
    channels = {}
    constants = {}
    for name in ('Base Color', 'Roughness', 'Metallic', 'Normal', 'Alpha', 'Specular IOR Level',
                 'Transmission Weight', 'IOR', 'Coat Weight', 'Coat Roughness', 'Sheen Weight'):
        socket = shader.inputs.get(name)
        if socket is None:
            continue
        if socket.is_linked:
            channels[name] = bake_channel(material, shader, bake_objects, name, directory, args.size, projection)
        elif name != 'Normal':
            value = socket.default_value
            constants[name] = list(value) if hasattr(value, '__len__') else float(value)
    result = {'sourceSha256': source_sha, 'material': identifier, 'size': args.size,
              'sourceNames': material.get('source_names'), 'objects': object_records, 'channels': channels,
              'constants': constants, 'sourceUV': 'VPB UV', 'bakeUV': 'Realtime Bake',
              'status': 'PBR_CHANNEL_BAKE_PENDING_BROWSER_REVIEW', 'hasBakedLighting': False,
              'method': 'coincident-source-projection' if projection else 'joined-uv-surface' if combined else 'direct-surface'}
    (directory / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    if combined:
        mesh = combined.data
        bpy.data.objects.remove(combined, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    if target_material:
        bpy.data.materials.remove(target_material)
    if args.proof:
        # A standard export shader makes the proof inspectable in Three.js.
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        shader = nodes.new('ShaderNodeBsdfPrincipled')
        output = nodes.new('ShaderNodeOutputMaterial')
        links.new(shader.outputs[0], output.inputs['Surface'])
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'Realtime Bake'
        for name, value in constants.items():
            shader.inputs[name].default_value = value
        for name, record in channels.items():
            node = nodes.new('ShaderNodeTexImage')
            node.image = bpy.data.images.load(str(OUT / record['file']), check_existing=False)
            node.image.colorspace_settings.name = record['colorSpace']
            links.new(uv.outputs['UV'], node.inputs['Vector'])
            socket = node.outputs['Color']
            if name == 'Normal':
                normal = nodes.new('ShaderNodeNormalMap')
                normal.uv_map = 'Realtime Bake'
                links.new(socket, normal.inputs['Color'])
                socket = normal.outputs['Normal']
            links.new(socket, shader.inputs[name])
        select(objects)
        bpy.ops.export_scene.gltf(filepath=str(OUT / 'material-proof.glb'), export_format='GLB',
                                  use_selection=True, export_animations=False, export_extras=True,
                                  export_texcoords=True, export_normals=True, export_tangents=True,
                                  export_image_format='AUTO', export_yup=True)
    print('MATERIAL_READY', identifier, len(objects), flush=True)


if __name__ == '__main__':
    identifiers = sorted({o.data.materials[0]['source_vpb_material_id'] for o in source.objects}) if args.ids == 'all' else list(map(int, args.ids.split(',')))
    for identifier in identifiers:
        bake_material(identifier)
    print('BAKE_BATCH_COMPLETE', flush=True)
