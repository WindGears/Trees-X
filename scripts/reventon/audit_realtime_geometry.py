"""Read-only check of exporter triangle differences; do not relax the asset gate."""
from pathlib import Path
import json
import bpy
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/realtime'
assert bpy.app.background
records = []
for obj in bpy.data.objects:
    if obj.type != 'MESH' or 'source_object_count' not in obj:
        continue
    mesh = obj.data
    mesh.calc_loop_triangles()
    xyz = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get('co', xyz)
    xyz = xyz.reshape(-1, 3)
    loops = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', loops)
    faces = loops.reshape(-1, 3)
    area = np.linalg.norm(np.cross(xyz[faces[:, 1]] - xyz[faces[:, 0]], xyz[faces[:, 2]] - xyz[faces[:, 0]]), axis=1) / 2
    records.append({'name': obj.name, 'polygons': len(mesh.polygons), 'loopTriangles': len(mesh.loop_triangles),
                    'zeroArea': int((area == 0).sum()), 'below1e12': int((area < 1e-12).sum()),
                    'duplicateIndices': int(((faces[:, 0] == faces[:, 1]) | (faces[:, 0] == faces[:, 2]) | (faces[:, 1] == faces[:, 2])).sum())})
(OUT / 'geometry-audit.json').write_text(json.dumps(records, indent=2))
print('GEOMETRY_AUDIT', json.dumps([r for r in records if r['zeroArea'] or r['loopTriangles'] != r['polygons']]))
