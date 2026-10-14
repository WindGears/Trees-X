"""Independent material master. Does not export/rewrite source geometry or bake assembly shadows.

Run with Blender --background --factory-startup --python this_file -- --textures NEW_DIR
or --master candidate.glb --output NEW.blend. Procedural maps are periodic, linear data.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import struct
import os

import bpy
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--textures')
parser.add_argument('--master')
parser.add_argument('--output')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
SIZE = 2048
SEEDS = {'paint': 731, 'brush': 1731, 'iron': 2731}
TILES = {'paint': 0.04, 'brush': 0.035, 'iron': 0.045}


def periodic_noise(seed, sigma_x, sigma_y):
    rng = np.random.Generator(np.random.PCG64(seed))
    noise = rng.standard_normal((SIZE, SIZE)).astype(np.float32)
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.rfftfreq(SIZE)[None, :]
    kernel = np.exp(-2 * np.pi ** 2 * (fx ** 2 * sigma_x ** 2 + fy ** 2 * sigma_y ** 2))
    smooth = np.fft.irfft2(np.fft.rfft2(noise) * kernel, s=noise.shape).astype(np.float32)
    smooth /= max(float(smooth.std()), 1e-8)
    return np.tanh(smooth / 2).astype(np.float32)


def write_image(directory, filename, rgb):
    image = bpy.data.images.new(filename, width=SIZE, height=SIZE, alpha=False, float_buffer=False)
    image.colorspace_settings.name = 'Non-Color'
    pixels = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    pixels[:, :, :3] = rgb
    image.pixels.foreach_set(pixels.ravel())
    image.file_format = 'PNG'
    image.filepath_raw = str(directory / filename)
    image.save()
    raw = (directory / filename).read_bytes()
    # Blender's PNG writer adds sRGB even to Non-Color image data. Remove only
    # color-interpretation metadata; every IDAT and pixel byte stays unchanged.
    chunks = [raw[:8]]
    offset = 8
    while offset < len(raw):
        size = struct.unpack_from('>I', raw, offset)[0]
        kind = raw[offset + 4:offset + 8]
        if kind not in (b'sRGB', b'gAMA', b'cHRM', b'iCCP'):
            chunks.append(raw[offset:offset + size + 12])
        offset += size + 12
    raw = b''.join(chunks)
    (directory / filename).write_bytes(raw)
    bpy.data.images.remove(image)
    return {'path': filename, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'width': SIZE, 'height': SIZE, 'colorSpace': 'linear data', 'format': 'PNG RGB8'}


if args.textures:
    directory = Path(args.textures).resolve()
    if directory.exists():
        raise RuntimeError('Use a new texture directory; existing assets are immutable')
    directory.mkdir(parents=True)
    files = []
    recipes = []
    for kind, seed in SEEDS.items():
        if kind == 'brush':
            height = periodic_noise(seed, 1.2, 54) * 0.75 + periodic_noise(seed + 1, 3, 125) * 0.25
            amplitude = 0.000002
        elif kind == 'paint':
            height = periodic_noise(seed, 5, 5) * 0.8 + periodic_noise(seed + 1, 1.6, 1.6) * 0.2
            amplitude = 0.000004
        else:
            height = periodic_noise(seed, 3, 3) * 0.65 + periodic_noise(seed + 1, 9, 9) * 0.35
            amplitude = 0.000015
        step = TILES[kind] / SIZE
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * amplitude / (2 * step)
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * amplitude / (2 * step)
        normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        files.append(write_image(directory, kind + '-normal.png', normal * 0.5 + 0.5))
        orm = np.ones((SIZE, SIZE, 3), dtype=np.float32)
        orm[:, :, 1] = np.clip(0.93 + height * (0.035 if kind != 'iron' else 0.065), 0, 1)
        files.append(write_image(directory, kind + '-orm.png', orm))
        recipes.append({'kind': kind, 'seed': seed, 'tileSceneUnits': TILES[kind],
                        'heightSceneUnits': amplitude, 'normalConvention': 'OpenGL +Y, linear RGB',
                        'periodicity': 'FFT periodic domain; centered wrap derivatives',
                        'roughness': 'G near 0.93; scalar material roughness retained',
                        'occlusion': 'not baked; R=1; no inter-part shadow', 'metalness': 'B=1'})
        if kind == 'brush':
            direction = np.ones((SIZE, SIZE, 3), dtype=np.float32)
            direction[:, :, 1] = 0.5
            direction[:, :, 2] = np.clip(0.96 + height * 0.025, 0, 1)
            files.append(write_image(directory, 'brush-direction.png', direction))
    report = {'version': 2, 'blenderVersion': bpy.app.version_string, 'size': SIZE,
              'method': 'Deterministic periodic procedural micro-height authored in Blender Python/NumPy; tangent normals from height derivatives; no lighting baked',
              'files': files, 'recipes': recipes, 'qualityApproved': False,
              'provenance': 'Trees X generated material data, no downloaded image inputs',
              'numpyVersion': np.__version__}
    (directory / 'textures.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'textures': len(files), 'directory': str(directory), 'blenderVersion': bpy.app.version_string}))

elif args.master and args.output:
    source = Path(args.master).resolve()
    output = Path(args.output).resolve()
    if output.exists():
        raise RuntimeError('Never overwrite an existing production master')
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Blender 5.2.2 importer crashes on the source's empty, zero-dispersion
    # extensions. Sanitize only an isolated import copy; the runtime is intact.
    source_bytes = source.read_bytes()
    json_size = struct.unpack_from('<I', source_bytes, 12)[0]
    document = json.loads(source_bytes[20:20 + json_size])
    removed = 0
    for material in document.get('materials', []):
        extension = material.get('extensions', {}).get('KHR_materials_dispersion')
        if extension is not None and extension.get('dispersion', 0) == 0:
            del material['extensions']['KHR_materials_dispersion']
            removed += 1
    if removed:
        document['extensionsUsed'] = [e for e in document.get('extensionsUsed', [])
                                      if e != 'KHR_materials_dispersion']
    for image in document.get('images', []):
        if 'uri' in image:
            image['uri'] = os.path.relpath(source.parent / image['uri'], output.parent).replace('\\', '/')
    raw = json.dumps(document, separators=(',', ':')).encode('utf-8')
    raw += b' ' * ((4 - len(raw) % 4) % 4)
    tail = source_bytes[20 + json_size:]
    import_path = output.parent / 'blender-import-only.glb'
    import_path.write_bytes(struct.pack('<IIIII', 0x46546c67, 2, 20 + len(raw) + len(tail),
                                       len(raw), 0x4e4f534a) + raw + tail)
    bpy.ops.import_scene.gltf(filepath=str(import_path))
    bpy.context.scene['Trees_X_material_version'] = 2
    bpy.context.scene['Trees_X_source_sha256'] = before
    bpy.context.scene['Trees_X_usage'] = 'Material inspection master; runtime assembled from preserved glTF accessors, not Blender re-export'
    bpy.context.scene['Trees_X_import_compatibility'] = f'{removed} empty zero-dispersion extensions removed in import copy only'
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    if hashlib.sha256(source.read_bytes()).hexdigest() != before:
        raise RuntimeError('Runtime asset changed during master creation')
    print(json.dumps({'master': str(output), 'objects': len(bpy.data.objects), 'sourceUnchanged': True}))
else:
    raise RuntimeError('Choose --textures or --master/--output')
