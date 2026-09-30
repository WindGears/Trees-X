"""Bind recovered VPB geometry to the verified rig and author a real camera film.

This is a production-layout preview. Final visual approval is still separate.
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
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-candidate.blend'
scene = bpy.context.scene
scene.frame_set(1)
scene.timeline_markers.clear()
source_hash = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
source = bpy.data.collections['VPB / Source-bound look candidate']
rest = {obj.name: np.array(obj.matrix_world) for obj in source.objects}
bound = {}
for obj in source.objects:
    path = json.loads(obj['source_vpb_path'])
    group = path[1]
    control = None
    if group == 'DOOR CLOSED':
        center = sum((obj.matrix_world @ Vector(c) for c in obj.bound_box), Vector()) / 8
        side = 1 if center.x > 0 else -1
        control = bpy.data.objects['Motion / Door ' + str(side)]
    elif group in ('LF', 'RF', 'LR', 'RR'):
        center = sum((obj.matrix_world @ Vector(c) for c in obj.bound_box), Vector()) / 8
        side, end = (1 if center.x > 0 else -1), (1 if center.y > .5 else -1)
        control = bpy.data.objects[f'Motion / Wheel {side} {end}']
    elif group == 'HOOD CLOSED':
        control = bpy.data.objects['Motion / Rear cover assembly']
    if control:
        assert obj.parent is None
        original = obj.matrix_world.copy()
        obj.parent = control
        obj.matrix_parent_inverse = control.matrix_world.inverted()
        obj.matrix_world = original
        bound.setdefault(control.name, []).append(obj.name)


def ease(value):
    x = min(1, max(0, value))
    return x * x * x * (x * (x * 6 - 15) + 10)


def pose(camera, position, target, frame):
    camera.location = position
    camera.rotation_mode = 'QUATERNION'
    camera.rotation_quaternion = (Vector(target) - camera.location).to_track_quat('-Z', 'Y')
    camera.keyframe_insert(data_path='location', frame=frame)
    camera.keyframe_insert(data_path='rotation_quaternion', frame=frame)


hero = bpy.data.objects['Camera / Hero']
opening = bpy.data.objects['Motion camera / Opening']
cabin = bpy.data.objects['Motion camera / Cabin']
structure = bpy.data.objects['Motion camera / Separation']
opening.data.lens = hero.data.lens
hero_position = hero.location.copy()
hero_target = Vector(hero['source_target'])
cabin_position = cabin.location.copy()
cabin_target = cabin_position + cabin.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
for camera in (opening, cabin, structure):
    camera.animation_data_clear()
    camera.data.animation_data_clear()
    camera.data.dof.use_dof = False

# Studio additions are explicitly authored. Original HDR remains the reflection
# source. The local cabin bounce only operates during the interior chapter.
for light in bpy.data.lights:
    if light.type == 'AREA':
        light.animation_data_clear()
        light.energy = 0
fill = bpy.data.lights['Studio / cabin bounce']
for frame in range(1, 385):
    a = ease((frame - 1) / 71)
    opening_target = hero_target + Vector((0, 0, .46 * a))
    pose(opening, opening_target + (hero_position - hero_target)
         + Vector((-.16 * a, .12 * a, .08 * a)), opening_target, frame)
    opening.data.lens = hero.data.lens / (1 + .35 * a)
    opening.data.keyframe_insert(data_path='lens', frame=frame)
    b = ease((frame - 97) / 95)
    pose(cabin, cabin_position + Vector((-.028 * b, .014 * b, .007 * b)),
         cabin_target + Vector((.06 * b, -.015 * b, -.014 * b)), frame)
    c = ease((frame - 193) / 191)
    structure_target = Vector((0, .35, .95))
    structure_position = Vector((5.8 - .5 * c, 6.8 + .4 * c, 3.3 - .25 * c))
    pose(structure, structure_target + (structure_position - structure_target) * 1.16,
         structure_target, frame)
    fill.energy = 130 if 97 <= frame <= 192 else 0
    fill.keyframe_insert(data_path='energy', frame=frame)

chapters = [
    {'id': 'doors', 'label': '开启', 'description': '沿着楔形轮廓，观察车门开启。', 'start': 0, 'end': 4, 'startFrame': 1, 'endFrame': 96, 'camera': opening.name},
    {'id': 'cabin', 'label': '座舱', 'description': '靠近皮革、碳纤维与中控细节。', 'start': 4, 'end': 8, 'startFrame': 97, 'endFrame': 192, 'camera': cabin.name},
    {'id': 'structure', 'label': '层次', 'description': '车轮、车门与后舱盖分离，再回到完整轮廓。', 'start': 8, 'end': 16, 'startFrame': 193, 'endFrame': 384, 'camera': structure.name},
]
for chapter in chapters:
    marker = scene.timeline_markers.new(chapter['id'], frame=chapter['startFrame'])
    marker.camera = bpy.data.objects[chapter['camera']]

checks = []
for frame in (1, 81, 144, 280, 384):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    matrices = [np.array(obj.matrix_world) for obj in source.objects]
    assert all(np.isfinite(matrix).all() for matrix in matrices)
    max_error = max(float(np.abs(np.array(obj.matrix_world) - rest[obj.name]).max()) for obj in source.objects)
    if frame in (1, 384):
        assert max_error < 2e-6, (frame, max_error)
    checks.append({'frame': frame, 'maxRestMatrixDifference': max_error, 'camera': scene.camera.name})
assert {len(v) for k, v in bound.items() if 'Door' in k} == {68}
assert sum(len(v) for v in bound.values()) == 653
scene.frame_set(1)
scene.frame_start, scene.frame_end = 1, 384
scene.render.fps, scene.render.fps_base = 24, 1
scene['film_status'] = 'VPB motion and camera preview; final reference fidelity still requires approval'
target = OUT / 'reventon-vpb-film.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=True)
report = {'sourceBlendSha256': source_hash, 'blendSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
          'fps': 24, 'frames': 384, 'seconds': 16, 'chapters': chapters,
          'boundGroups': {k: len(v) for k, v in bound.items()}, 'checks': checks,
          'status': 'MOTION_AND_PLAYBACK_PREVIEW', 'finalVisualApproved': False,
          'limitations': ['Existing component separation, not engineering disassembly', 'Rear-cover linkage not mechanically articulated',
                          'Cycles source-reference fidelity not yet approved', 'Continuous rendered collision/temporal-noise review still required']}
(OUT / 'vpb-film.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('VPB_FILM_READY', json.dumps(report, ensure_ascii=True))
