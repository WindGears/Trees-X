"""Isolated CPU lighting studies. Never change the in-flight motion film."""
from pathlib import Path
import json
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/reflection-study'
OUT.mkdir(exist_ok=True)
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-candidate.blend'
scene = bpy.context.scene
scene.timeline_markers.clear()
scene.frame_set(1)
scene.camera = bpy.data.objects['Camera / Hero']
scene.render.resolution_x, scene.render.resolution_y = 1280, 566
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'
scene.cycles.device = 'CPU'
scene.cycles.samples = 32
scene.cycles.adaptive_threshold = .04
scene.render.threads_mode = 'FIXED'
scene.render.threads = 6
for light in bpy.data.lights:
    if light.type == 'AREA':
        light.animation_data_clear()
        light.energy = 0
backdrop = bpy.data.objects['Studio / curved backdrop']
backdrop.visible_glossy = False
backdrop.visible_transmission = False
backdrop.visible_diffuse = False
report = {'world': {}, 'tests': []}
for node in scene.world.node_tree.nodes:
    if node.type == 'BACKGROUND':
        report['world'][node.name] = node.inputs['Strength'].default_value
material = next(m for m in bpy.data.materials if m.get('source_vpb_material_id') == 20159)
paint = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
report['paint'] = {s.name: list(s.default_value) if s.type == 'RGBA' else s.default_value
                   for s in paint.inputs if s.name in ('Base Color', 'Metallic', 'Roughness', 'Coat Weight')}
for name, transform in [('hdr-unoccluded-agx', 'AgX'), ('hdr-unoccluded-standard', 'Standard')]:
    scene.view_settings.view_transform = transform
    scene.view_settings.look = 'None'
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
    report['tests'].append({'name': name, 'transform': transform})
    (OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('REFLECTION_STUDY_COMPLETE', flush=True)
