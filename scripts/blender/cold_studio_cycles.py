"""Independent background Cycles studio. Never opens or edits a user's Blender scene.
Imports exact runtime triangles; native Three/Blender BRDF differences remain documented.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import gzip
import bpy
import numpy as np
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--size', type=int, default=1024)
parser.add_argument('--samples', type=int, default=256)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
assert bpy.app.background
source_path = Path(args.source).resolve()
out = source_path.parent
data = json.loads(source_path.read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
for device in prefs.devices:
    device.use = device.type == 'OPTIX'
assert any(device.use for device in prefs.devices), 'OptiX device unavailable'
scene.cycles.device = 'GPU'
scene.cycles.samples = args.samples
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.seed = 10425
scene.cycles.max_bounces = 12
scene.cycles.diffuse_bounces = 8
scene.cycles.glossy_bounces = 8
scene.cycles.sample_clamp_direct = 0
scene.cycles.sample_clamp_indirect = 0
scene.render.resolution_x = scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '32'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.exr_codec = 'ZIP'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0

def xyz(values):
    values = np.asarray(values).reshape(-1, 3)
    return np.stack((values[:, 0], -values[:, 2], values[:, 1]), axis=1)

panels = []
for item in data['meshes']:
    positions = xyz(item['position'])
    indices = np.asarray(item['index'] if item['index'] is not None else range(len(positions))).reshape(-1, 3)
    mesh = bpy.data.meshes.new(item['id'])
    mesh.from_pydata(positions.tolist(), [], indices.tolist())
    mesh.update()
    normals = xyz(item['normal'])
    mesh.normals_split_custom_set_from_vertices(normals.tolist())
    for face in mesh.polygons:
        face.use_smooth = True
    if item['uv']:
        uv = np.asarray(item['uv']).reshape(-1, 2)
        layer = mesh.uv_layers.new(name='RuntimeUV')
        for loop in mesh.loops:
            layer.data[loop.index].uv = uv[loop.vertex_index]
    obj = bpy.data.objects.new(item['id'], mesh)
    scene.collection.objects.link(obj)
    mat = bpy.data.materials.new(item['id'])
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    settings = item['material']
    bsdf.inputs['Base Color'].default_value = (*settings['color'], 1)
    bsdf.inputs['Roughness'].default_value = settings['roughness']
    bsdf.inputs['Metallic'].default_value = settings['metalness']
    bsdf.inputs['Coat Weight'].default_value = settings['clearcoat']
    bsdf.inputs['Coat Roughness'].default_value = settings['clearcoatRoughness']
    if item['lightId']:
        emission = nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (*settings['color'], 1)
        emission.inputs['Strength'].default_value = 1
        links.new(emission.outputs[0], nodes['Material Output'].inputs['Surface'])
        panels.append(obj)
    elif item['id'] == 'floor':
        for channel, file in [('base', 'floor-albedo.png'), ('roughness', 'floor-roughness.png'), ('normal', 'floor-normal.png')]:
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(str(Path(data['textureDirectory']) / file))
            tex.image.colorspace_settings.name = 'sRGB' if channel == 'base' else 'Non-Color'
            tex.extension = 'REPEAT'
            if channel == 'base':
                multiply = nodes.new('ShaderNodeMixRGB')
                multiply.blend_type = 'MULTIPLY'
                multiply.inputs[0].default_value = 1
                multiply.inputs[2].default_value = (*settings['color'], 1)
                links.new(tex.outputs['Color'], multiply.inputs[1])
                links.new(multiply.outputs[0], bsdf.inputs['Base Color'])
            elif channel == 'roughness':
                multiply = nodes.new('ShaderNodeMath')
                multiply.operation = 'MULTIPLY'
                multiply.use_clamp = True
                multiply.inputs[1].default_value = settings['roughness']
                links.new(tex.outputs['Color'], multiply.inputs[0])
                links.new(multiply.outputs[0], bsdf.inputs['Roughness'])
            else:
                normal = nodes.new('ShaderNodeNormalMap')
                normal.inputs['Strength'].default_value = settings['normalScale'][0]
                links.new(tex.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs[0], bsdf.inputs['Normal'])
    obj.data.materials.append(mat)

camera_data = bpy.data.cameras.new('Probe')
camera = bpy.data.objects.new('Probe', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = xyz(data['config']['capture']['position'])[0]
camera_data.type = 'PERSP'
camera_data.lens = 16
camera_data.sensor_width = 32
camera_data.clip_start = 0.01
camera_data.clip_end = 100
faces = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
started = time.time()
records = []
for role in ['specular', 'indirect']:
    # Hide only the camera-visible emitter, retaining its illumination/bounces.
    for panel in panels:
        panel.visible_camera = role == 'specular'
    rendered = []
    bases = []
    for index, direction in enumerate(faces):
        forward = np.array(direction, dtype=float)
        up = np.array((0, 0, -1) if direction[1] == 1 else (0, 0, 1) if direction[1] == -1 else (0, 1, 0), dtype=float)
        right = np.cross(forward, up)
        f, r, u = (Vector(xyz(v)[0]) for v in (forward, right, up))
        camera.rotation_euler = Matrix((r, u, -f)).transposed().to_euler()
        scene.render.filepath = str(out / f'{role}-face-{index}.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath, check_existing=False)
        pixels = np.empty(args.size * args.size * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        # Blender image data is bottom-up, while the reprojection below addresses top-down faces.
        rendered.append(pixels.reshape(args.size, args.size, 4)[::-1].copy())
        bpy.data.images.remove(image)
        bases.append((forward, right, up))
    width, height = (args.size * 4, args.size * 2) if role == 'specular' else (1024, 512)
    panorama = np.zeros((height, width, 4), dtype=np.float32)
    for row in range(height):
        theta = ((np.arange(width) + .5) / width - .5) * 2 * math.pi
        phi = (.5 - (row + .5) / height) * math.pi
        directions = np.column_stack((math.cos(phi) * np.cos(theta), np.full(width, math.sin(phi)), math.cos(phi) * np.sin(theta)))
        dominant = np.argmax(np.abs(directions), axis=1)
        for index, (forward, right, up) in enumerate(bases):
            axis = index // 2
            mask = (dominant == axis) & (directions[:, axis] * forward[axis] > 0)
            rays = directions[mask]
            depth = rays @ forward
            sx = np.clip(((rays @ right) / depth + 1) * .5 * args.size - .5, 0, args.size - 1)
            sy = np.clip((1 - (rays @ up) / depth) * .5 * args.size - .5, 0, args.size - 1)
            ix, iy = sx.astype(int), sy.astype(int)
            jx, jy = np.minimum(ix + 1, args.size - 1), np.minimum(iy + 1, args.size - 1)
            tx, ty = (sx - ix)[:, None], (sy - iy)[:, None]
            face = rendered[index]
            panorama[row, mask] = (face[iy, ix] * (1-tx) + face[iy, jx] * tx) * (1-ty) + (face[jy, ix] * (1-tx) + face[jy, jx] * tx) * ty
    assert np.isfinite(panorama).all() and panorama[:, :, :3].max() > 0
    raw = panorama.astype('<f4').tobytes()
    payload = gzip.compress(raw, compresslevel=9, mtime=0)
    file = f'{role}.rgba32f.bin'
    (out / file).write_bytes(payload)
    records.append({'role': role, 'file': file, 'width': width, 'height': height,
        'bytes': len(payload), 'rawBytes': len(raw), 'sha256': hashlib.sha256(payload).hexdigest(),
        'rawSha256': hashlib.sha256(raw).hexdigest()})
    (out / 'progress.json').write_text(json.dumps({'completed': role, 'seconds': time.time()-started}))
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'cold-studio.blend'))
(out / 'manifest.json').write_text(json.dumps({'config': data['config'], 'records': records,
    'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(), 'samples': args.samples,
    'faceSize': args.size, 'engine': 'Cycles OptiX; OIDN; 12 bounces; no clamp',
    'seconds': time.time()-started, 'blender': bpy.app.version_string,
    'excludes': ['car', 'UI', 'contact shadow overlay', 'bloom']}, indent=2))
