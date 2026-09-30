"""Checkpointed genuine Cycles frames. Preview and final masters are separate."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import sys
import time
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
parser = argparse.ArgumentParser()
parser.add_argument('--stills', action='store_true')
parser.add_argument('--final', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
film = json.loads((OUT / 'vpb-film.json').read_text(encoding='utf-8'))
digest = hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest()
assert digest == film['blendSha256']
if args.final:
    assert film['finalVisualApproved'], 'Final master render requires the source-reference visual gate'
scene = bpy.context.scene
scene.render.resolution_percentage = 100
scene.render.resolution_x, scene.render.resolution_y = (3968, 1758) if args.final else (1920, 850)
scene.cycles.samples = 512 if args.final else 96
scene.cycles.adaptive_threshold = .005 if args.final else .02
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'
scene.render.use_persistent_data = True
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
gpu = [d for d in prefs.devices if d.type == 'OPTIX']
assert gpu
for device in prefs.devices: device.use = device in gpu
scene.cycles.device = 'GPU'
mode = 'final' if args.final else ('stills' if args.stills else 'preview')
folder = OUT / ('film-' + mode + '-' + digest[:12])
folder.mkdir(exist_ok=True)
manifest_path = folder / 'manifest.json'
settings = {'blendSha256': digest, 'mode': mode, 'samples': scene.cycles.samples,
            'resolution': [scene.render.resolution_x, scene.render.resolution_y],
            'adaptiveThreshold': scene.cycles.adaptive_threshold, 'viewTransform': scene.view_settings.view_transform,
            'fps': 24, 'totalFrames': 384}
manifest = {'settings': settings, 'frames': {}, 'status': 'running'}
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    assert manifest['settings'] == settings, 'Cannot resume frames from different settings'
manifest['pid'] = os.getpid()
manifest['status'] = 'running'


def checkpoint():
    manifest['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    temporary = manifest_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    temporary.replace(manifest_path)
    progress = {k: manifest[k] for k in ('pid', 'status', 'updatedAt')}
    progress.update({'folder': str(folder.relative_to(ROOT)), 'mode': mode, 'frames': len(manifest['frames']),
                     'blendSha256': digest, 'total': 5 if args.stills else 384})
    progress_path = OUT / ('film-' + mode + '-progress.json')
    progress_tmp = progress_path.with_suffix('.tmp')
    progress_tmp.write_text(json.dumps(progress, indent=2), encoding='utf-8')
    progress_tmp.replace(progress_path)


checkpoint()
try:
    frames = (1, 81, 144, 280, 384) if args.stills else range(1, 385)
    for frame in frames:
        filename = f'frame-{frame:04d}.png'
        target = folder / filename
        prior = manifest['frames'].get(str(frame))
        if prior and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == prior['sha256']:
            continue
        scene.frame_set(frame)
        chapter = next(c for c in film['chapters'] if c['startFrame'] <= frame <= c['endFrame'])
        assert scene.camera.name == chapter['camera']
        temporary = folder / (f'frame-{frame:04d}.rendering.png')
        scene.render.filepath = str(temporary)
        started = time.monotonic()
        bpy.ops.render.render(write_still=True)
        assert scene.camera.name == chapter['camera']
        temporary.replace(target)
        entry = {'file': filename, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                 'seconds': round(time.monotonic() - started, 3), 'chapter': chapter['id'], 'camera': scene.camera.name}
        if args.final:
            master = target.with_suffix('.exr')
            scene.render.image_settings.file_format = 'OPEN_EXR'
            bpy.data.images['Render Result'].save_render(filepath=str(master), scene=scene)
            scene.render.image_settings.file_format = 'PNG'
            entry.update({'master': master.name, 'masterSha256': hashlib.sha256(master.read_bytes()).hexdigest()})
        manifest['frames'][str(frame)] = entry
        checkpoint()
        print('FILM_FRAME_COMPLETE', frame, entry['seconds'], flush=True)
    manifest['status'] = 'complete'
    checkpoint()
except BaseException as error:
    manifest['status'] = 'failed'
    manifest['error'] = str(error)
    checkpoint()
    raise
print('FILM_RENDER_COMPLETE', str(folder), flush=True)
