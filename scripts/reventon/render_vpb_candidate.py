"""Render a source-bound candidate into separate, versioned review outputs."""
from pathlib import Path
import hashlib
import json
import sys
import time
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-candidate.blend'
scene = bpy.context.scene
scene.frame_set(1)
assert not any(marker.camera for marker in scene.timeline_markers), 'Motion markers must not override still cameras'
full = '--full' in sys.argv
folder = OUT / ('vpb-candidate-stills' if full else 'vpb-candidate-preview')
folder.mkdir(exist_ok=True)
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
gpu = [d for d in prefs.devices if d.type == 'OPTIX']
assert gpu
for device in prefs.devices:
    device.use = device in gpu
scene.cycles.device = 'GPU'
scene.render.resolution_percentage = 100 if full else 40
scene.cycles.samples = 512 if full else 96
scene.cycles.adaptive_threshold = .005 if full else .02
report = {'mode': '4K-quality-candidate' if full else 'look-preview',
          'blendSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          'resolutionPercent': scene.render.resolution_percentage, 'samples': scene.cycles.samples,
          'viewTransform': scene.view_settings.view_transform, 'device': [d.name for d in gpu], 'shots': []}
for name, camera in [('hero', 'Camera / Hero'), ('cabin', 'Motion camera / Cabin')]:
    scene.camera = bpy.data.objects[camera]
    target = folder / (name + '.png')
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '16'
    scene.render.filepath = str(target)
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    assert scene.camera.name == camera
    entry = {'id': name, 'file': str(target.relative_to(ROOT)), 'seconds': round(time.monotonic() - started, 2),
             'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
    if full:
        master = target.with_suffix('.exr')
        scene.render.image_settings.file_format = 'OPEN_EXR'
        bpy.data.images['Render Result'].save_render(filepath=str(master), scene=scene)
        entry.update({'master': str(master.relative_to(ROOT)), 'masterSha256': hashlib.sha256(master.read_bytes()).hexdigest()})
    report['shots'].append(entry)
(folder / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('VPB_CANDIDATE_RENDER_COMPLETE', json.dumps(report))
