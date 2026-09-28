"""Prepare an editable 16-second motion proof without approving final film quality.

Run against the restored scene in a separate background Blender. All source
vertices/materials remain intact; articulation uses source-verified transforms.
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
assert bpy.app.background, 'Use a separate Blender process'
assert Path(bpy.data.filepath).name == 'reventon-restored.blend'
source_hash = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
source = json.loads((OUT / 'source/manifest.json').read_text())
motion = json.loads((OUT / 'motion-analysis.json').read_text())
cache = np.load(OUT / 'source/geometry.npz')
scene = bpy.context.scene
originals = bpy.data.collections['Reventon / Original Geometry']
objects = {obj.data.name: obj for obj in originals.all_objects}
collection = bpy.data.collections.new('Motion proof / controls and cameras')
scene.collection.children.link(collection)
ground = scene['ground_offset']
quality = {'engine': scene.render.engine, 'samples': scene.cycles.samples,
           'adaptiveThreshold': scene.cycles.adaptive_threshold,
           'maxBounces': scene.cycles.max_bounces, 'denoising': scene.cycles.use_denoising,
           'resolution': [scene.render.resolution_x, scene.render.resolution_y],
           'viewTransform': scene.view_settings.view_transform}


def control(name, pivot, members):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.location = pivot
    obj['members'] = [item.name for item in members]
    bpy.context.view_layer.update()
    inverse = obj.matrix_world.inverted()
    for member in members:
        assert member.parent is None, member.name
        member.parent = obj
        member.matrix_parent_inverse = inverse
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def camera(name, position, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens, data.clip_start, data.clip_end = lens, 0.01, 10000
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = position
    aim(obj, target)
    return obj


doors = []
for item in motion['doors']:
    pivot = list(item['pivotSource'])
    pivot[0] = item['side'] * 0.85
    pivot[2] += ground
    obj = control('Motion / Door ' + str(item['side']), pivot, [objects[key] for key in item['members']])
    doors.append((obj, item, Vector(pivot)))

wheel_members = {(side, end): [] for side in (-1, 1) for end in (-1, 1)}
for item in source['meshes']:
    layer = item['layer']
    centre = np.array(item['bounds']).mean(0)
    is_wheel = layer.startswith(('TIRE', 'RIM', 'BRAKE')) or layer == 'DISK'
    is_badge = layer == 'LOGO NEW' and abs(centre[0]) > 0.8
    if is_wheel or is_badge:
        wheel_members[(1 if centre[0] > 0 else -1, 1 if centre[1] > 0.5 else -1)].append(objects[item['key']])
for decal in bpy.data.collections['Restoration / original wordmark decals'].objects:
    centre = sum((Vector(v) for v in decal.bound_box), Vector()) / 8
    wheel_members[(1 if centre.x > 0 else -1, 1 if centre.y > 0.5 else -1)].append(decal)
wheels = [(control(f'Motion / Wheel {side} {end}', (0, 0, 0), members), side, end)
          for (side, end), members in wheel_members.items()]
hood = control('Motion / Rear cover assembly', (0, 0, 0),
               [objects[item['key']] for item in source['meshes'] if item['layer'] == 'HOOD CLOSED'])
hood['limitation'] = 'Assembly translation only. Support linkage not rigged for mechanical opening.'

opening = camera('Motion camera / Opening', (5.4, 7.5, 1.75), (0, 0.4, 0.8), 52)
records = {r['id']: r['fields'] for r in json.loads((OUT / 'source/vpb-cameras.json').read_text()) if r['type'] == 'CameraSetting'}
record = records[31118]
fov = record['fieldOfView']['value'][0]
lens = 36 / (scene.render.resolution_x / scene.render.resolution_y) / (2 * math.tan(fov / 2))
cabin = camera('Motion camera / Cabin', np.array(record['from']['value']) / 256,
               np.array(record['at']['value']) / 256, lens)
cabin['source_camera_id'] = 31118
exploded = camera('Motion camera / Separation', (5.8, 6.8, 3.3), (0, 0.35, 0.7), 46)


def ease(frame, start, end):
    x = max(0, min(1, (frame - start) / (end - start)))
    return x * x * x * (x * (x * 6 - 15) + 10)


scene.render.fps = 24
scene.render.fps_base = 1
scene.frame_start, scene.frame_end = 1, 384
for frame in range(1, 385):
    door_open = ease(frame, 13, 72) * (1 - ease(frame, 301, 360))
    separation = ease(frame, 205, 264) * (1 - ease(frame, 301, 360))
    for obj, item, pivot in doors:
        obj.rotation_euler.x = item['angleX'] * door_open
        obj.location = pivot + Vector((item['side'] * 0.55 * separation, 0, 0.18 * separation))
        obj.keyframe_insert(data_path='rotation_euler', frame=frame)
        obj.keyframe_insert(data_path='location', frame=frame)
    for obj, side, end in wheels:
        obj.location = (side * 0.65 * separation, end * 0.12 * separation, 0.04 * separation)
        obj.keyframe_insert(data_path='location', frame=frame)
    hood.location = (0, -0.15 * separation, 0.7 * separation)
    hood.keyframe_insert(data_path='location', frame=frame)

chapters = [
    {'id': 'doors', 'label': '车门开启', 'startFrame': 1, 'endFrame': 96, 'camera': opening.name},
    {'id': 'cabin', 'label': '座舱观察', 'startFrame': 97, 'endFrame': 192, 'camera': cabin.name},
    {'id': 'structure', 'label': '部件分离与合拢', 'startFrame': 193, 'endFrame': 384, 'camera': exploded.name},
]
for chapter in chapters:
    marker = scene.timeline_markers.new(chapter['label'], frame=chapter['startFrame'])
    marker.camera = bpy.data.objects[chapter['camera']]

# Evaluate true world coordinates at the source open pose and after reassembly.
checks = []
for frame in (1, 81, 384):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    maximum = 0
    for obj, item, _ in doors:
        for pair in item['pairs']:
            member = objects[pair['closed']]
            A = cache[pair['closed'] + '_v']
            world = np.array(member.matrix_world)
            actual = A @ world[:3, :3].T + world[:3, 3]
            expected = cache[pair['open' if frame == 81 else 'closed'] + '_v'].astype(float)
            expected[:, 2] += ground
            maximum = max(maximum, float(np.linalg.norm(actual - expected, axis=1).max()))
    assert maximum < 0.000002, (frame, maximum)
    checks.append({'frame': frame, 'maxDoorVertexError': maximum})
for key, obj in objects.items():
    v = np.empty((len(obj.data.vertices), 3), dtype='float32')
    obj.data.vertices.foreach_get('co', v.ravel())
    np.testing.assert_array_equal(v, cache[key + '_v'])
    assert all(mat.use_nodes for mat in obj.data.materials)
scene.frame_set(1)
scene.camera = opening
scene['motion_status'] = 'Editable motion proof. Static and animation quality not approved; not a production web film.'
scene['structure_scope'] = motion['structureScope']
target = OUT / 'reventon-motion-proof.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=True)
report = {'sourceBlendSha256': source_hash, 'blend': str(target.relative_to(ROOT)),
          'blendSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'fps': 24, 'frames': 384, 'seconds': 16, 'chapters': chapters,
          'qualitySettings': quality, 'doorPoseChecks': checks,
          'wheelGroups': [len(m) for m in wheel_members.values()],
          'sourceMeshesUnchanged': len(objects), 'status': 'MOTION_PROOF_NOT_FILM_APPROVED',
          'limitations': motion['limitations']}
(OUT / 'motion-proof.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print('MOTION_PROOF_READY', json.dumps(report, ensure_ascii=False))
