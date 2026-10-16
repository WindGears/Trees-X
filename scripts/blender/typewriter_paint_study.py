"""Author independent paint-study data, never edit the typewriter or its v2 assets.

Blender --background --factory-startup --python scripts/blender/typewriter_paint_study.py
  -- assets-source/typewriter-paint/orange-peel.png
     assets-source/typewriter-paint/polish.png NEW_OUTPUT_DIRECTORY

Generated images are art references, not measured PBR or recovered micro-height.
Their detrended periodic masks only modulate a controlled, seeded micro-surface.
The .blend is a material inspection scene, not a replacement model/rig export.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

import bpy
import numpy as np


SIZE = 2048
SEED = 10731
TILE = 0.04
AMPLITUDE = 0.000004
ROOT = Path(__file__).resolve().parents[2]
REFERENCE_NORMAL = ROOT / 'public/models/bundles/kimi-typewriter/v2/textures/paint-normal.png'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def statistics(data):
    return {
        'min': float(np.min(data)), 'max': float(np.max(data)),
        'mean': float(np.mean(data)), 'standardDeviation': float(np.std(data)),
        'rms': float(np.sqrt(np.mean(np.square(data)))),
    }


def gaussian(data, sigma_x, sigma_y=None):
    sigma_y = sigma_x if sigma_y is None else sigma_y
    h, w = data.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    kernel = np.exp(-2 * np.pi ** 2 * (fx * fx * sigma_x ** 2 + fy * fy * sigma_y ** 2))
    return np.fft.irfft2(np.fft.rfft2(data) * kernel, s=data.shape).astype(np.float32)


def standardize(data):
    result = data - data.mean()
    return (result / max(float(result.std()), 1e-8)).astype(np.float32)


def periodic_component(data):
    """Periodic-plus-smooth decomposition; the smooth boundary correction is discarded."""
    h, w = data.shape
    boundary = np.zeros_like(data)
    boundary[0, :] = data[-1, :] - data[0, :]
    boundary[-1, :] = -boundary[0, :]
    boundary[:, 0] += data[:, -1] - data[:, 0]
    boundary[:, -1] -= data[:, -1] - data[:, 0]
    fy = np.arange(h, dtype=np.float64)[:, None]
    fx = np.arange(w // 2 + 1, dtype=np.float64)[None, :]
    denominator = 2 * np.cos(2 * np.pi * fy / h) + 2 * np.cos(2 * np.pi * fx / w) - 4
    denominator[0, 0] = 1
    spectrum = np.fft.rfft2(boundary) / denominator
    spectrum[0, 0] = 0
    smooth = np.fft.irfft2(spectrum, s=data.shape)
    return (data - smooth).astype(np.float32)


def read_reference(path, role):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        native_size = list(image.size)
        image.colorspace_settings.name = 'Non-Color'
        if min(native_size) < 256:
            raise RuntimeError('Reference is too small to carry useful art-direction masks')
        image.scale(SIZE, SIZE)
        rgba = np.empty(SIZE * SIZE * 4, dtype=np.float32)
        image.pixels.foreach_get(rgba)
        rgb = rgba.reshape(SIZE, SIZE, 4)[:, :, :3]
        # Numeric visual luminance is used only as a bounded art mask, never as measured height.
        luminance = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
        periodic = periodic_component(luminance)
        detrended = gaussian(periodic, 3) - gaussian(periodic, 112)
        mask = np.tanh(standardize(detrended) / 2).astype(np.float32)
        return mask, {
            'role': role, 'path': str(path), 'bytes': path.stat().st_size,
            'sha256': sha256(path), 'nativeWidth': native_size[0], 'nativeHeight': native_size[1],
            'workingWidth': SIZE, 'workingHeight': SIZE,
            'method': 'Blender image scaling; periodic-plus-smooth boundary removal; wrap Gaussian 3px minus 112px; bounded normalized mask',
            'claim': 'AI-authored visual distribution only; not a scan, not measured roughness or recovered surface height',
            'maskStatistics': statistics(mask),
        }
    finally:
        bpy.data.images.remove(image)


def periodic_noise(seed, sigma_x, sigma_y=None):
    rng = np.random.Generator(np.random.PCG64(seed))
    noise = rng.standard_normal((SIZE, SIZE)).astype(np.float32)
    return np.tanh(standardize(gaussian(noise, sigma_x, sigma_y)) / 2).astype(np.float32)


def slopes(height):
    step = TILE / SIZE
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * AMPLITUDE / (2 * step)
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * AMPLITUDE / (2 * step)
    return dx, dy


def normal_from_height(height):
    dx, dy = slopes(height)
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal.astype(np.float32)


def slope_rms(normal):
    slope = normal[:, :, :2] / np.maximum(normal[:, :, 2:3], 1e-6)
    return float(np.sqrt(np.mean(np.sum(slope * slope, axis=-1))))


def read_normal(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        if tuple(image.size) != (SIZE, SIZE):
            raise RuntimeError('Reference normal resolution changed; inspect v2 before authoring')
        image.colorspace_settings.name = 'Non-Color'
        rgba = np.empty(SIZE * SIZE * 4, dtype=np.float32)
        image.pixels.foreach_get(rgba)
        return rgba.reshape(SIZE, SIZE, 4)[:, :, :3] * 2 - 1
    finally:
        bpy.data.images.remove(image)


def png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def write_png(directory, name, values, bits=8):
    """Numeric PNG without gamma/sRGB/ICC; arrays use Blender's bottom-up +V rows."""
    gray = values.ndim == 2
    if not gray and values.shape[2] != 3:
        raise RuntimeError('Only grayscale or RGB data images are supported')
    levels = 65535 if bits == 16 else 255
    encoded = np.rint(np.clip(np.flipud(values), 0, 1) * levels)
    encoded = encoded.astype('>u2' if bits == 16 else np.uint8)
    rows = b''.join(b'\0' + row.tobytes() for row in encoded)
    raw = b'\x89PNG\r\n\x1a\n'
    raw += png_chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, bits, 0 if gray else 2, 0, 0, 0))
    raw += png_chunk(b'IDAT', zlib.compress(rows, 9))
    raw += png_chunk(b'IEND', b'')
    path = directory / name
    path.write_bytes(raw)
    return {
        'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        'width': SIZE, 'height': SIZE, 'format': 'PNG ' + ('GRAY' if gray else 'RGB') + str(bits),
        'colorSpace': 'linear data', 'metadata': 'IHDR, IDAT, IEND only; no sRGB, ICC or gamma',
        'statistics': statistics(values),
    }


def seam_statistics(values):
    dx = np.abs(values - np.roll(values, 1, axis=1))
    dy = np.abs(values - np.roll(values, 1, axis=0))
    return {
        'wrapXMeanDifference': float(dx[:, 0].mean()),
        'wrapYMeanDifference': float(dy[0, :].mean()),
        'allAdjacentXMeanDifference': float(dx.mean()),
        'allAdjacentYMeanDifference': float(dy.mean()),
        'note': 'Periodic adjacent samples need not be identical; compare seam steps to interior steps',
    }


def make_master(directory, metadata):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene['Trees_X_material_study'] = 'AI art masks + controlled periodic numerical paint; no typewriter model imported'
    scene['Trees_X_recipe_json'] = json.dumps(metadata, ensure_ascii=False)
    scene['Trees_X_runtime_geometry_unchanged'] = True
    material = bpy.data.materials.new('WindGear black enamel — paint study only')
    material.use_nodes = True
    material.diffuse_color = (0.012, 0.012, 0.012, 1)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (900, 0)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (580, 0)
    bsdf.inputs['Base Color'].default_value = (0.012, 0.012, 0.012, 1)
    bsdf.inputs['Metallic'].default_value = 0.035
    bsdf.inputs['Coat Weight'].default_value = 0.76
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-700, 0)
    mapping.inputs['Scale'].default_value = (1 / TILE, 1 / TILE, 1 / TILE)
    coordinates = nodes.new('ShaderNodeTexCoord')
    coordinates.location = (-930, 0)
    links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
    loaded = {}
    for index, filename in enumerate(('paint-normal.png', 'paint-orm.png', 'paint-coat-roughness.png')):
        image = bpy.data.images.load(str(directory / filename), check_existing=False)
        image.colorspace_settings.name = 'Non-Color'
        image.pack()
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        texture.extension = 'REPEAT'
        texture.location = (-430, 260 - index * 300)
        links.new(mapping.outputs['Vector'], texture.inputs['Vector'])
        loaded[filename] = texture
    normal = nodes.new('ShaderNodeNormalMap')
    normal.location = (80, 250)
    links.new(loaded['paint-normal.png'].outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    for index, (filename, scalar, socket) in enumerate((
        ('paint-orm.png', 0.26, 'Roughness'),
        ('paint-coat-roughness.png', 0.15, 'Coat Roughness'),
    )):
        separate = nodes.new('ShaderNodeSeparateColor')
        separate.location = (-70, -index * 280)
        links.new(loaded[filename].outputs['Color'], separate.inputs['Color'])
        multiply = nodes.new('ShaderNodeMath')
        multiply.operation = 'MULTIPLY'
        multiply.location = (260, -index * 280)
        multiply.inputs[1].default_value = scalar
        links.new(separate.outputs['Green'], multiply.inputs[0])
        links.new(multiply.outputs[0], bsdf.inputs[socket])
    for filename in ('paint-height-master.png', 'paint-roughness-master.png', 'paint-coat-roughness-master.png'):
        image = bpy.data.images.load(str(directory / filename), check_existing=False)
        image.colorspace_settings.name = 'Non-Color'
        image.pack()
        image.use_fake_user = True
    bpy.ops.mesh.primitive_cube_add(size=0.12, location=(0, 0, 0))
    coupon = bpy.context.object
    coupon.name = 'Inspection coupon only — no typewriter geometry'
    coupon.scale.z = 0.08
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = coupon.modifiers.new('Inspection edge', 'BEVEL')
    bevel.width = 0.002
    bevel.segments = 5
    coupon.data.materials.append(material)
    for polygon in coupon.data.polygons:
        polygon.use_smooth = True
    scene['Trees_X_preview_scalars'] = 'enamel roughness .26, metallic .035, clearcoat .76, coat roughness .15; actual runtime profiles preserved by assembler'
    bpy.ops.wm.save_as_mainfile(filepath=str(directory / 'paint-study.blend'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('orange')
    parser.add_argument('polish')
    parser.add_argument('output')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    orange_path, polish_path, directory = (Path(value).resolve() for value in (args.orange, args.polish, args.output))
    for source in (orange_path, polish_path, REFERENCE_NORMAL):
        if not source.is_file():
            raise RuntimeError('Missing required, immutable input: ' + str(source))
    if directory.exists():
        raise RuntimeError('Use a new output directory; previous material masters are immutable')
    source_digests = {source: sha256(source) for source in (orange_path, polish_path, REFERENCE_NORMAL)}
    orange, orange_info = read_reference(orange_path, 'orange-peel art distribution')
    polish, polish_info = read_reference(polish_path, 'restrained wiping/polish art distribution')
    v2_rms = slope_rms(read_normal(REFERENCE_NORMAL))
    # Authored frequency bands carry shape. References can vary amplitude by at most 8%.
    base = periodic_noise(SEED, 5.8) * 0.82 + periodic_noise(SEED + 1, 2.2) * 0.18
    envelope = 1 + gaussian(orange, 20) * 0.08
    height = base * envelope
    height -= height.mean()
    candidate_rms = slope_rms(normal_from_height(height))
    # Slightly lower slope than v2 protects distant specular stability; never amplify its slope.
    slope_scale = min(1.0, v2_rms * 0.94 / max(candidate_rms, 1e-9))
    height *= slope_scale
    normal = normal_from_height(height)
    # Quantization is accounted for below; roughness means stay comparable to the v2 study.
    polish_bands = gaussian(polish, 10, 32)
    polish_bands -= polish_bands.mean()
    subtle = periodic_noise(SEED + 2, 15, 44)
    subtle -= subtle.mean()
    roughness = np.clip(0.93 + polish_bands * 0.025 + subtle * 0.008 + height * 0.005, 0, 1)
    roughness += 0.93 - roughness.mean()
    coat_roughness = np.clip(0.94 + polish_bands * 0.018 + subtle * 0.006, 0, 1)
    coat_roughness += 0.94 - coat_roughness.mean()
    orm = np.ones((SIZE, SIZE, 3), dtype=np.float32)
    orm[:, :, 1] = roughness
    coat_rgb = np.ones_like(orm)
    coat_rgb[:, :, 1] = coat_roughness
    # Signed height is encoded in a documented symmetric range, not silently auto-normalized.
    height_range = max(1.0, float(np.abs(height).max()))
    height_master = height / (height_range * 2) + 0.5
    directory.mkdir(parents=True)
    files = [
        write_png(directory, 'paint-normal.png', normal * 0.5 + 0.5),
        write_png(directory, 'paint-orm.png', orm),
        write_png(directory, 'paint-coat-roughness.png', coat_rgb),
        write_png(directory, 'paint-height-master.png', height_master, 16),
        write_png(directory, 'paint-roughness-master.png', roughness, 16),
        write_png(directory, 'paint-coat-roughness-master.png', coat_roughness, 16),
    ]
    encoded_normal = np.rint((normal * 0.5 + 0.5) * 255) / 255 * 2 - 1
    encoded_rms = slope_rms(encoded_normal)
    if encoded_rms > v2_rms * 1.005:
        raise RuntimeError('Quantized candidate normal exceeds reference slope budget; inspect output, do not publish')
    report = {
        'version': 'paint-study-1', 'size': SIZE, 'seed': SEED,
        'blenderVersion': bpy.app.version_string, 'numpyVersion': np.__version__,
        'method': 'Controlled periodic seeded micro-height modulated by detrended AI art masks; centered wrap derivatives; no lighting or assembly shadows baked',
        'qualityApproved': False, 'measuredPbr': False,
        'inputs': [orange_info, polish_info],
        'reference': {'path': str(REFERENCE_NORMAL), 'sha256': source_digests[REFERENCE_NORMAL], 'quantizedSlopeRms': v2_rms},
        'recipes': [{
            'kind': 'paint', 'seed': SEED, 'tileSceneUnits': TILE, 'heightSceneUnits': AMPLITUDE,
            'normalConvention': 'OpenGL +Y; Blender bottom-up +V rows; N=(-dHdu,-dHdv,1)',
            'periodicity': 'Seeded FFT periodic fields; periodic-plus-smooth input masks; centered wrap derivatives',
            'heightConstruction': '0.82 Gaussian sigma 5.8px seeded band + 0.18 sigma 2.2px band; 8% bounded image-mask amplitude only; zero mean',
            'slopeScale': slope_scale, 'preLimitSlopeRms': candidate_rms,
            'finalSlopeRms': slope_rms(normal), 'finalQuantizedSlopeRms': encoded_rms,
            'roughness': 'ORM G mean .93; only low-amplitude spatial polish variation; runtime material scalars retained',
            'clearcoatRoughness': 'G mean .94; runtime clearcoat scalars retained',
            'heightMasterDecode': f'(GRAY16 / 65535 * 2 - 1) * {height_range} * {AMPLITUDE} scene units',
            'occlusion': 'R=1; no inter-part or fixed assembly occlusion', 'metalness': 'B=1; scalar retained',
        }],
        'statistics': {
            'height': statistics(height * AMPLITUDE), 'normal': statistics(normal),
            'roughness': statistics(roughness), 'clearcoatRoughness': statistics(coat_roughness),
            'heightSeam': seam_statistics(height), 'roughnessSeam': seam_statistics(roughness),
        },
        'files': files,
        'provenance': 'Trees X: GPT image references + Blender Python/NumPy authored numeric maps. Source images retain their native resolution and are not described as scans or measured PBR.',
        'limitations': ['No model, UV, triangle, pivot, material binding or rig edited', 'No assembly shadow baked', 'No claim of physical measurements or automatic PBR recovery', 'Actual rendering and distant specular stability require browser comparison'],
    }
    (directory / 'textures.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    make_master(directory, report)
    blend = directory / 'paint-study.blend'
    report['master'] = {'path': blend.name, 'bytes': blend.stat().st_size, 'sha256': sha256(blend), 'role': 'Independent editable Blender material inspection scene; no source geometry'}
    for source, before in source_digests.items():
        if sha256(source) != before:
            raise RuntimeError('An immutable source changed during authoring: ' + str(source))
    (directory / 'textures.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(directory), 'runtimeTextures': 3, 'masters': 4, 'nativeInputs': [orange_info['nativeWidth'], orange_info['nativeHeight'], polish_info['nativeWidth'], polish_info['nativeHeight']], 'referenceSlopeRms': v2_rms, 'candidateSlopeRms': encoded_rms, 'qualityApproved': False}))


if __name__ == '__main__':
    main()
