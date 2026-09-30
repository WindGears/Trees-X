"""Read-only validation of every frame in the merged source-bound motion scene."""
from pathlib import Path
import hashlib
import json
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
film = json.loads((OUT / 'vpb-film.json').read_text(encoding='utf-8'))
assert hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest() == film['blendSha256']
scene = bpy.context.scene
objects = list(bpy.data.collections['VPB / Source-bound look candidate'].objects)
assert len(objects) == 2998
corners = np.ones((len(objects), 8, 4))
corners[:, :, :3] = np.array([list(obj.bound_box) for obj in objects])
matrices_at_start = None
framing = []
vertex_cache = {}
for frame in range(1, 385):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    matrices = np.array([obj.matrix_world for obj in objects])
    assert np.isfinite(matrices).all()
    if frame == 1:
        matrices_at_start = matrices.copy()
    if frame == 384:
        assert np.abs(matrices - matrices_at_start).max() < 2e-6
    chapter = next(c for c in film['chapters'] if c['startFrame'] <= frame <= c['endFrame'])
    assert scene.camera.name == chapter['camera']
    if chapter['id'] == 'cabin':
        continue  # Interior close-ups intentionally exclude most exterior geometry.
    world = np.einsum('nij,nkj->nki', matrices, corners).reshape((-1, 4))
    projection = scene.camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=1920, y=850)
    view = scene.camera.matrix_world.inverted()
    clip = world @ np.array(projection @ view).T
    assert (clip[:, 3] > 0).all()
    screen = clip[:, :2] / clip[:, 3:4] * .5 + .5
    per_object = screen.reshape((-1, 8, 2))
    lows, highs = per_object.min(axis=1), per_object.max(axis=1)
    candidates = np.where((lows < 0).any(axis=1) | (highs > 1).any(axis=1))[0]
    for index in candidates:
        # Bounding-box corners are empty space; use the actual source vertices
        # before declaring a real crop on a diagonally oriented large part.
        obj = objects[index]
        if obj.name not in vertex_cache:
            xyz = np.empty(len(obj.data.vertices) * 3)
            obj.data.vertices.foreach_get('co', xyz)
            local = np.ones((len(obj.data.vertices), 4))
            local[:, :3] = xyz.reshape((-1, 3))
            vertex_cache[obj.name] = local
        exact_clip = vertex_cache[obj.name] @ np.array(projection @ view @ obj.matrix_world).T
        assert (exact_clip[:, 3] > 0).all()
        exact = exact_clip[:, :2] / exact_clip[:, 3:4] * .5 + .5
        lows[index], highs[index] = exact.min(axis=0), exact.max(axis=0)
    low, high = lows.min(axis=0), highs.max(axis=0)
    assert (low >= 0).all() and (high <= 1).all(), (frame, low, high)
    framing.append({'frame': frame, 'min': low.tolist(), 'max': high.tolist()})
report = {'blendSha256': film['blendSha256'], 'status': 'pass', 'framesChecked': 384,
          'sourceObjects': len(objects), 'boundObjects': sum(film['boundGroups'].values()),
          'finiteTransforms': True, 'chapterCameras': True, 'returnsToRest': True,
          'exteriorSourceGeometryInsideFrame': True, 'framing': framing,
          'limits': ['Bounding boxes do not prove collision-free motion or unobstructed camera rays',
                     'This is a motion invariant check, not source-reference visual approval']}
(OUT / 'vpb-film-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('FILM_VERIFIED', film['blendSha256'], flush=True)
