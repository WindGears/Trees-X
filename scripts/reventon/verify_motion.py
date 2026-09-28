"""Verify the saved motion proof at chapter boundaries and every animation frame."""
from pathlib import Path
import hashlib
import json
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background
assert Path(bpy.data.filepath).name == 'reventon-motion-proof.blend'
report = json.loads((OUT / 'motion-proof.json').read_text())
assert hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest() == report['blendSha256']
scene = bpy.context.scene
quality = report['qualitySettings']
assert scene.cycles.samples == quality['samples'] == 512
assert scene.cycles.adaptive_threshold == quality['adaptiveThreshold']
assert scene.render.resolution_percentage == 100
assert [scene.render.resolution_x, scene.render.resolution_y] == quality['resolution'] == [3968, 1758]
assert scene.view_settings.view_transform == quality['viewTransform']
assert scene.render.engine == quality['engine']
assert scene.cycles.max_bounces == quality['maxBounces']
assert scene.cycles.use_denoising == quality['denoising']
objects = list(bpy.data.collections['Reventon / Original Geometry'].all_objects)
scene.frame_set(1)
initial = {obj.name: np.array(obj.matrix_world) for obj in objects}
controls = [obj for obj in bpy.data.collections['Motion proof / controls and cameras'].objects if obj.type == 'EMPTY']
assert len(controls) == 7
assert all(obj.animation_data and obj.animation_data.action for obj in controls)
source_geometry = np.load(OUT / 'source/geometry.npz')
for obj in objects:
    vertices = np.empty((len(obj.data.vertices), 3), dtype='float32')
    obj.data.vertices.foreach_get('co', vertices.ravel())
    np.testing.assert_array_equal(vertices, source_geometry[obj.data.name + '_v'])
for frame in range(1, 385):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    for obj in controls:
        matrix = np.array(obj.matrix_world)
        assert np.isfinite(matrix).all()
        # Rotation/translation only: no squeezing or scale collapse.
        np.testing.assert_allclose(matrix[:3, :3].T @ matrix[:3, :3], np.eye(3), atol=1e-6)
    if frame in (1, 384):
        for obj in objects:
            np.testing.assert_allclose(obj.matrix_world, initial[obj.name], atol=1e-6)
for collection in bpy.data.collections['Reventon / Original Geometry'].children:
    if collection.name.endswith(('DOOR OPEN', 'HOOD OPEN')):
        assert collection.hide_render
assert all(im.packed_file for im in bpy.data.images if im.type == 'IMAGE' and im.users)
assert len(scene.timeline_markers) == 3
result = {'result': 'PASS', 'framesChecked': 384, 'sourceMeshes': len(objects),
          'blendSha256': report['blendSha256'], 'qualitySettingsUnchanged': True,
          'checks': ['rigid transforms across all frames', 'all source objects return to initial pose',
                     'source vertices preserved', 'reference open variants stay hidden',
                     'three camera chapters', 'images packed', 'render settings preserved'],
          'limits': 'Not collision certification, temporal-noise approval or reference-quality approval.'}
(OUT / 'motion-verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print('MOTION_VERIFIED', json.dumps(result))
