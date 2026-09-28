"""Check the saved Blender scene against the independently extracted source data.

Run in a background Blender after opening reventon-restored.blend.
This is an integrity check, never an approval of photographic quality.
"""
from pathlib import Path
import hashlib
import json
import math
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
manifest = json.loads((OUT / 'source/manifest.json').read_text())
cache = np.load(OUT / 'source/geometry.npz')
objects = {obj.data.name: obj for obj in bpy.data.collections['Reventon / Original Geometry'].all_objects}
assert len(objects) == len(manifest['meshes']) == 618
for source in manifest['meshes']:
    key = source['key']
    obj = objects[key]
    mesh = obj.data
    positions = np.empty((len(mesh.vertices), 3), dtype='float32')
    mesh.vertices.foreach_get('co', positions.ravel())
    np.testing.assert_array_equal(positions, cache[key + '_v'], err_msg=key)
    indices = np.empty(len(mesh.loops), dtype='int32')
    mesh.loops.foreach_get('vertex_index', indices)
    np.testing.assert_array_equal(indices.reshape(-1, 3), cache[key + '_f'], err_msg=key)
    uv = np.empty((len(mesh.loops), 2), dtype='float32')
    mesh.uv_layers['Source UV'].data.foreach_get('uv', uv.ravel())
    np.testing.assert_array_equal(uv, cache[key + '_uv'][indices], err_msg=key)
    assert mesh.has_custom_normals, key
    assert len(mesh.materials) > 0, key
    assert obj['source_sourceObjectId'] == source['sourceObjectId'], key
    assert abs(obj.location.z - bpy.context.scene['ground_offset']) < 1e-7, key

unpacked = [im.name for im in bpy.data.images if im.type == 'IMAGE' and im.users and not im.packed_file]
assert not unpacked, unpacked
records = {r['id']: r for r in json.loads((OUT / 'source/vpb-cameras.json').read_text())}
scale = records[15002]['fields']['scale']['value']
np.testing.assert_array_equal(scale, [256, 256, 256])
metadata = json.loads((OUT / 'source/reference-metadata.json').read_text())['6-beauty.jpg']['vred']
camera_ns = '{http://ns.autodesk.com/vred/1.0/camera/}'
hero = bpy.data.objects['Camera / Hero']
source = records[31158]['fields']
for field, prop in [('from', 'source_position'), ('at', 'source_target')]:
    expected = np.array(source[field]['value']) / 256
    np.testing.assert_allclose(hero[prop], expected, atol=1e-6)
    # JPEG serializes only six significant digits, unlike the float VPB record.
    np.testing.assert_allclose(np.array(metadata[camera_ns + field].split(), dtype=float),
                               source[field]['value'], atol=0.005, rtol=0)
np.testing.assert_allclose(hero.location, hero['source_position'], atol=1e-6)
direction = (Vector(hero['source_target']) - hero.location).normalized()
actual = hero.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
np.testing.assert_allclose(actual, direction, atol=1e-6)
scene = bpy.context.scene
vertical_fov = 2 * math.atan(hero.data.sensor_width / (scene.render.resolution_x / scene.render.resolution_y) / (2 * hero.data.lens))
assert abs(math.degrees(vertical_fov) - float(metadata[camera_ns + 'fieldOfView'])) < 0.00001
wheel = bpy.data.objects['Camera / Wheel']
np.testing.assert_allclose(wheel.location, np.array(wheel['source_position']) + wheel['authored_position_offset'], atol=1e-6)
assert len(bpy.data.collections['Restoration / original wordmark decals'].objects) == 4
assert scene.render.engine == 'CYCLES'
assert 'not film approved' in scene['quality_gate']
report = {
    'result': 'PASS',
    'blendSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    'sourceMeshesCompared': len(objects),
    'checks': ['every source vertex, triangle index and UV preserved', 'custom normals present',
               'source identity retained', 'referenced images packed', 'source transform scale',
               'hero source/JPEG camera agreement', 'wheel authored offset declared',
               'four source-image wordmark decals', 'Cycles engine', 'quality gate remains open'],
    'scope': 'Saved scene integrity. No claim that reference lighting or photographic quality is matched.'
}
(OUT / 'scene-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('REVENTON_SCENE_VERIFIED', json.dumps(report))
