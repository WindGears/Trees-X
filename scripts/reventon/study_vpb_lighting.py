"""Bounded diagnostic renders; these previews are never final-quality evidence."""
from pathlib import Path
import json
import math
import sys
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from materials import socket, set_input

assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-candidate.blend'
scene = bpy.context.scene
scene.timeline_markers.clear()
scene.render.resolution_percentage = 40
scene.cycles.samples = 64
scene.cycles.adaptive_threshold = .025
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
for device in prefs.devices:
    device.use = device.type == 'OPTIX'
scene.cycles.device = 'GPU'
OUT = ROOT / 'artifacts/reventon/vpb-light-study'
OUT.mkdir(exist_ok=True)
backdrop = bpy.data.objects['Studio / curved backdrop']
backdrop.visible_transmission = True
world_mapping = next(n for n in scene.world.node_tree.nodes if n.type == 'MAPPING')
glass = [o for o in bpy.data.collections['VPB / Source-bound look candidate'].objects if o['source_vpb_material'] == 19931]
energies = {light: light.energy for light in bpy.data.lights}
scene.camera = bpy.data.objects['Camera / Hero']
for name, rotation, lights, lens in [('no-lens', 0, True, False), ('environment-only', 0, False, True),
                                     ('source-yaw', -3.089, False, True), ('yaw-90', math.pi / 2, False, True)]:
    set_input(world_mapping, 'Rotation', (0, 0, rotation))
    for light, energy in energies.items(): light.energy = energy if lights else 0
    for obj in glass: obj.hide_render = not lens
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
for obj in glass: obj.hide_render = False
set_input(world_mapping, 'Rotation', (0, 0, 0))
for light, energy in energies.items(): light.energy = energy
scene.camera = bpy.data.objects['Motion camera / Cabin']
data = bpy.data.lights.new('Study / cabin bounce', 'AREA')
data.shape = 'RECTANGLE'; data.size = 1.4; data.size_y = .8
obj = bpy.data.objects.new(data.name, data); scene.collection.objects.link(obj)
obj.location = (1.5, .35, 1.55)
obj.rotation_euler = (Vector((-.3, .55, .65)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
for power in (60, 150):
    data.energy = power
    scene.render.filepath = str(OUT / ('cabin-fill-' + str(power) + '.png'))
    bpy.ops.render.render(write_still=True)
print('LIGHT_STUDY_COMPLETE')
