"""Render three actual 3D motion proof states; no 2D slideshow or film substitution."""
from pathlib import Path
import hashlib
import json
import sys
import time
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background
assert Path(bpy.data.filepath).name == 'reventon-motion-proof.blend'
scene = bpy.context.scene
preview = '--preview' in sys.argv
folder = OUT / ('motion-preview' if preview else 'motion-stills')
folder.mkdir(exist_ok=True)
prefs = bpy.context.preferences.addons['cycles'].preferences
assert 'OPTIX' in [item[0] for item in prefs.get_device_types(bpy.context)]
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
devices = [device for device in prefs.devices if device.type == 'OPTIX']
assert devices
for device in prefs.devices:
    device.use = device in devices
scene.cycles.device = 'GPU'
if preview:
    scene.render.resolution_percentage = 40
    scene.cycles.samples = 64
    scene.cycles.adaptive_threshold = 0.025
else:
    assert scene.render.resolution_percentage == 100 and scene.cycles.samples == 512
shots = []
for name, frame, camera in [('doors', 81, 'Opening'), ('cabin', 144, 'Cabin'), ('structure', 280, 'Separation')]:
    scene.frame_set(frame)
    scene.camera = bpy.data.objects['Motion camera / ' + camera]
    scene.render.image_settings.file_format = 'PNG'
    target = folder / (name + '.png')
    scene.render.filepath = str(target)
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    entry = {'id': name, 'frame': frame, 'file': str(target.relative_to(ROOT)),
             'seconds': round(time.monotonic() - started, 2), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
    if not preview:
        scene.render.image_settings.file_format = 'OPEN_EXR'
        master = target.with_suffix('.exr')
        bpy.data.images['Render Result'].save_render(filepath=str(master), scene=scene)
        entry['linearMaster'] = str(master.relative_to(ROOT))
        entry['masterSha256'] = hashlib.sha256(master.read_bytes()).hexdigest()
    shots.append(entry)
report = {'mode': 'layout-preview' if preview else 'quality-check-stills',
          'blendSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          'resolutionPercent': scene.render.resolution_percentage, 'samples': scene.cycles.samples,
          'viewTransform': scene.view_settings.view_transform, 'device': [d.name for d in devices], 'shots': shots}
(folder / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('MOTION_STILLS_COMPLETE', json.dumps(report))
