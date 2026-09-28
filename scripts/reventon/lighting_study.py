"""Bounded four-angle lighting comparison, rendered from actual geometry."""
from pathlib import Path
import math
import bpy

OUT=Path(__file__).resolve().parents[2]/'artifacts/reventon/renders'
scene=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences
assert 'OPTIX' in [t[0] for t in prefs.get_device_types(bpy.context)]
prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU';scene.cycles.samples=48;scene.cycles.adaptive_threshold=.035
scene.render.resolution_percentage=30
scene.camera=bpy.data.objects['Camera / Hero']
mapping=next(n for n in scene.world.node_tree.nodes if n.type=='MAPPING')
for angle in (0,90,180,270):
    mapping.inputs['Rotation'].default_value.z=math.radians(angle)
    scene.render.filepath=str(OUT/f'lighting-{angle}.png')
    bpy.ops.render.render(write_still=True)
