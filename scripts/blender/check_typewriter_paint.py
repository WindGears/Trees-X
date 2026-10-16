"""CPU-only numeric audit of the paint-study maps; never imports or edits the model.

Blender --background --factory-startup --threads 8 --python-exit-code 1
  --python scripts/blender/check_typewriter_paint.py
  -- [artifacts/typewriter-paint/materials] [artifacts/typewriter-paint/map-audit.json]
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zlib

import bpy
import numpy as np


ROOT = Path(__file__).resolve().parents[2]
NUMERIC_FILES = (
    'paint-normal.png', 'paint-orm.png', 'paint-coat-roughness.png',
    'paint-height-master.png', 'paint-roughness-master.png', 'paint-coat-roughness-master.png',
)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def numbers(values):
    return {
        'min': float(values.min()), 'max': float(values.max()),
        'mean': float(values.mean()), 'rms': float(np.sqrt(np.mean(values * values))),
    }


def parse_png(path):
    raw = path.read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise RuntimeError('Not PNG: ' + str(path))
    offset, kinds, payload = 8, [], []
    width = height = bits = color = None
    while offset < len(raw):
        length = struct.unpack_from('>I', raw, offset)[0]
        kind = raw[offset + 4:offset + 8]
        data = raw[offset + 8:offset + 8 + length]
        crc = struct.unpack_from('>I', raw, offset + 8 + length)[0]
        if (zlib.crc32(kind + data) & 0xffffffff) != crc:
            raise RuntimeError('PNG CRC mismatch: ' + str(path))
        kinds.append(kind.decode('ascii'))
        if kind == b'IHDR':
            width, height, bits, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data)
            if (compression, filtering, interlace) != (0, 0, 0):
                raise RuntimeError('Unexpected PNG layout: ' + str(path))
        elif kind == b'IDAT':
            payload.append(data)
        offset += length + 12
    if (width, height) != (2048, 2048) or (bits, color) not in ((8, 2), (16, 0)):
        raise RuntimeError('Unexpected numeric PNG format: ' + str(path))
    forbidden = sorted(set(kinds).intersection(('sRGB', 'gAMA', 'iCCP', 'cHRM')))
    if forbidden:
        raise RuntimeError('Data PNG contains color interpretation chunks: ' + ', '.join(forbidden))
    channels = 3 if color == 2 else 1
    row_bytes = width * channels * bits // 8
    rows = np.frombuffer(zlib.decompress(b''.join(payload)), dtype=np.uint8).reshape(height, row_bytes + 1)
    # The production numerical writer deliberately emits filter zero for easy independent audit.
    if np.any(rows[:, 0] != 0):
        raise RuntimeError('Unexpected filter in independently authored numeric PNG: ' + str(path))
    samples = rows[:, 1:].copy()
    values = samples.view('>u2' if bits == 16 else np.uint8).reshape(height, width, channels)
    values = values.astype(np.float32) / (65535 if bits == 16 else 255)
    if channels == 1:
        values = values[:, :, 0]
    return values, {'width': width, 'height': height, 'bitDepth': bits,
                    'colorType': color, 'chunks': kinds, 'forbiddenColorChunks': forbidden}


def read_blender(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        image.colorspace_settings.name = 'Non-Color'
        width, height = image.size
        rgba = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(rgba)
        return rgba.reshape(height, width, 4)[:, :, :3].copy()
    finally:
        bpy.data.images.remove(image)


def compare(actual, expected):
    difference = np.abs(actual - expected)
    return {'maximumAbsoluteError': float(difference.max()),
            'meanAbsoluteError': float(difference.mean()),
            'rmsError': float(np.sqrt(np.mean(difference * difference)))}


def seam_statistics(values):
    # Repeat textures contain adjacent samples at the seam, not duplicated end pixels.
    dx = np.abs(values - np.roll(values, 1, axis=1))
    dy = np.abs(values - np.roll(values, 1, axis=0))
    inside_x, inside_y = float(dx[:, 1:].mean()), float(dy[1:, :].mean())
    seam_x, seam_y = float(dx[:, 0].mean()), float(dy[0, :].mean())
    return {
        'boundaryXMeanAbsoluteStep': seam_x, 'interiorXMeanAbsoluteStep': inside_x,
        'boundaryYMeanAbsoluteStep': seam_y, 'interiorYMeanAbsoluteStep': inside_y,
        'boundaryToInteriorXRatio': seam_x / max(inside_x, 1e-12),
        'boundaryToInteriorYRatio': seam_y / max(inside_y, 1e-12),
        'boundaryXMaximumAbsoluteStep': float(dx[:, 0].max()),
        'boundaryYMaximumAbsoluteStep': float(dy[0, :].max()),
        'visualSeamAccepted': False,
        'interpretation': 'Numerical adjacency statistics only; not a claim of visually seamless rendering',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('materials', nargs='?', default='artifacts/typewriter-paint/materials')
    parser.add_argument('output', nargs='?', default='artifacts/typewriter-paint/map-audit.json')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    directory, output = (ROOT / args.materials).resolve(), (ROOT / args.output).resolve()
    if ROOT not in output.parents or 'artifacts' not in output.relative_to(ROOT).parts:
        raise RuntimeError('Audit output must be inside the project artifacts directory')
    recipe_path = directory / 'textures.json'
    recipe = json.loads(recipe_path.read_text(encoding='utf-8'))
    records = {entry['path']: entry for entry in recipe['files']}
    arrays, files = {}, []
    for filename in NUMERIC_FILES:
        path = directory / filename
        record = records[filename]
        before = digest(path)
        if before != record['sha256'] or path.stat().st_size != record['bytes']:
            raise RuntimeError('Production record mismatch: ' + filename)
        storage, png = parse_png(path)
        blender = read_blender(path)
        expected_blender = np.flipud(storage)
        if storage.ndim == 2:
            expected_blender = np.repeat(expected_blender[:, :, None], 3, axis=2)
        orientation = compare(blender, expected_blender)
        if orientation['maximumAbsoluteError'] > 1e-6:
            raise RuntimeError('Blender +V / PNG row orientation mismatch: ' + filename)
        arrays[filename] = blender[:, :, 0] if storage.ndim == 2 else blender
        files.append({
            'path': str(path.relative_to(ROOT)).replace('\\', '/'),
            'bytes': path.stat().st_size, 'sha256': before, 'png': png,
            'blenderVsFlippedPng': orientation,
        })
    config = recipe['recipes'][0]
    decode = re.fullmatch(r'\(GRAY16 / 65535 \* 2 - 1\) \* ([0-9.eE+-]+) \* ([0-9.eE+-]+) scene units', config['heightMasterDecode'])
    if decode is None:
        raise RuntimeError('Unrecognized height decode; do not eval configuration text')
    symmetric_range, amplitude = (float(value) for value in decode.groups())
    if amplitude != config['heightSceneUnits']:
        raise RuntimeError('Height encoding amplitude differs from recipe')
    height_scene = (arrays['paint-height-master.png'] * 2 - 1) * symmetric_range * amplitude
    step = config['tileSceneUnits'] / height_scene.shape[1]
    dx = (np.roll(height_scene, -1, axis=1) - np.roll(height_scene, 1, axis=1)) / (2 * step)
    dy = (np.roll(height_scene, -1, axis=0) - np.roll(height_scene, 1, axis=0)) / (2 * step)
    expected_normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    expected_normal /= np.linalg.norm(expected_normal, axis=-1, keepdims=True)
    expected_rgb = expected_normal * 0.5 + 0.5
    actual_rgb = arrays['paint-normal.png']
    normal_errors = {channel: compare(actual_rgb[:, :, index], expected_rgb[:, :, index])
                     for index, channel in enumerate(('R', 'G', 'B'))}
    # GRAY16 height error is amplified by centered derivatives; bound it explicitly.
    height_quantization_slope_margin = symmetric_range * amplitude / (65535 * step)
    threshold = 1 / 255 + height_quantization_slope_margin * 2 + 1e-6
    for channel, error in normal_errors.items():
        if error['maximumAbsoluteError'] > threshold:
            raise RuntimeError('Normal differs from encoded height beyond quantization bound: ' + channel)
    correct_y = compare(actual_rgb[:, :, 1], expected_rgb[:, :, 1])
    inverted_y = compare(actual_rgb[:, :, 1], 1 - expected_rgb[:, :, 1])
    correlation = float(np.corrcoef(actual_rgb[:, :, 1].ravel(), expected_rgb[:, :, 1].ravel())[0, 1])
    if correlation < 0.95 or correct_y['rmsError'] >= inverted_y['rmsError'] * 0.5:
        raise RuntimeError('Normal Y handedness is not decisively OpenGL +Y')
    roughness_results = {}
    for runtime, master in (
        ('paint-orm.png', 'paint-roughness-master.png'),
        ('paint-coat-roughness.png', 'paint-coat-roughness-master.png'),
    ):
        actual, expected = arrays[runtime][:, :, 1], arrays[master]
        error = compare(actual, expected)
        bound = 0.5 / 255 + 0.5 / 65535 + 1e-6
        if error['maximumAbsoluteError'] > bound:
            raise RuntimeError('Runtime roughness G does not match its master: ' + runtime)
        if not np.all(arrays[runtime][:, :, 0] == 1) or not np.all(arrays[runtime][:, :, 2] == 1):
            raise RuntimeError('ORM/coat non-G channels must remain white')
        roughness_results[runtime] = {'G': numbers(actual), 'comparisonToMaster': error, 'allowedError': bound}
    source_checks = []
    for entry in [*recipe['inputs'], recipe['reference']]:
        path = Path(entry['path'])
        if not path.is_file() or digest(path) != entry['sha256']:
            raise RuntimeError('Immutable source digest mismatch: ' + str(path))
        source_checks.append({'path': str(path.relative_to(ROOT)).replace('\\', '/'),
                              'bytes': path.stat().st_size, 'sha256': digest(path), 'matched': True})
    for file in files:
        if digest(ROOT / file['path']) != file['sha256']:
            raise RuntimeError('Audited data changed while reading: ' + file['path'])
    normal = actual_rgb * 2 - 1
    slope = normal[:, :, :2] / np.maximum(normal[:, :, 2:3], 1e-6)
    normal_slope_rms = float(np.sqrt(np.mean(np.sum(slope * slope, axis=-1))))
    report = {
        'passed': True, 'auditType': 'CPU numerical and metadata verification only; no render or GPU work',
        'blenderVersion': bpy.app.version_string, 'numpyVersion': np.__version__,
        'recipeSha256': digest(recipe_path), 'files': files, 'sourceChecks': source_checks,
        'normalFromHeight': {
            'method': 'Independently decoded 16-bit height master, scene-unit decode, centered wrap derivatives in Blender +V orientation, normalize(-dHdu,-dHdv,1)',
            'perChannelError': normal_errors, 'allowedEncodedChannelError': threshold,
            'heightQuantizationSlopeMargin': height_quantization_slope_margin,
            'openGlY': {'confirmed': True, 'correlation': correlation,
                        'correctGreen': correct_y, 'invertedGreen': inverted_y},
            'quantizedSlopeRms': normal_slope_rms,
            'recipeQuantizedSlopeRms': config['finalQuantizedSlopeRms'],
        },
        'roughness': roughness_results,
        'seams': {name: seam_statistics(array) for name, array in arrays.items()},
        'limitations': [
            'No image render, browser texture sampling, tangent-basis or visual seam approval performed',
            'Numeric +Y confirmation does not validate every model UV/tangent orientation',
            'No claim of measured PBR or physical orange-peel heights',
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': True, 'output': str(output.relative_to(ROOT)).replace('\\', '/'),
                      'normalMaximumError': max(error['maximumAbsoluteError'] for error in normal_errors.values()),
                      'normalAllowedError': threshold, 'greenCorrelation': correlation,
                      'quantizedSlopeRms': normal_slope_rms}))


if __name__ == '__main__':
    main()
