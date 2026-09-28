"""Render authored validation cameras from the saved local .blend, without UI blocking."""
from pathlib import Path
import json
import hashlib
import sys
import time
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts/reventon/renders'
OUTPUT.mkdir(parents=True, exist_ok=True)
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
preview = '--preview' in args
scene = bpy.context.scene
prefs = bpy.context.preferences.addons['cycles'].preferences
available = [item[0] for item in prefs.get_device_types(bpy.context)]
if 'OPTIX' not in available:
    raise RuntimeError('OptiX unavailable; inspect devices before selecting a different backend')
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
gpu = [d for d in prefs.devices if d.type == 'OPTIX']
if not gpu:
    raise RuntimeError('No OptiX GPU found')
for device in prefs.devices:
    device.use = device in gpu
scene.cycles.device = 'GPU'
scene.render.resolution_percentage = 40 if preview else 100
scene.cycles.samples = 64 if preview else 512
scene.cycles.adaptive_threshold = 0.025 if preview else 0.005
report = {'mode':'preview' if preview else 'validation','device':[d.name for d in gpu],
          'resolutionPercent':scene.render.resolution_percentage,'samples':scene.cycles.samples,
          'adaptiveThreshold':scene.cycles.adaptive_threshold,'viewTransform':scene.view_settings.view_transform,
          'blend':bpy.data.filepath,'blendSha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          'shots':[]}
for shot in ('Hero','Wheel'):
    scene.camera = bpy.data.objects['Camera / ' + shot]
    target = OUTPUT / (shot.lower() + ('-preview' if preview else '-validation') + '.png')
    scene.render.filepath = str(target)
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    entry={'shot':shot,'file':str(target.relative_to(ROOT)),'seconds':round(time.monotonic()-started,2),
           'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size}
    if not preview:
        scene.render.image_settings.file_format='OPEN_EXR'
        master=target.with_suffix('.exr')
        bpy.data.images['Render Result'].save_render(filepath=str(master),scene=scene)
        scene.render.image_settings.file_format='PNG'
        entry['linearMaster']=str(master.relative_to(ROOT))
        entry['masterSha256']=hashlib.sha256(master.read_bytes()).hexdigest()
    report['shots'].append(entry)
(OUTPUT / ('preview-report.json' if preview else 'validation-report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
print('REVENTON_RENDER_COMPLETE',json.dumps(report))
