"""Verify exactly which original faces Blender's mandatory glTF validation removes."""
from pathlib import Path
import collections
import json
import bpy
import numpy as np
OUT = Path(__file__).resolve().parents[2] / 'artifacts/reventon/realtime'
assert bpy.app.background and Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
source = bpy.data.collections['VPB / Source-bound look candidate']
records = []
totals = collections.Counter()
for obj in source.objects:
    mesh = obj.data
    indices = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', indices)
    faces = indices.reshape(-1, 3)
    unique = np.unique(np.sort(faces, axis=1), axis=0)
    duplicates = len(faces) - len(unique)
    if duplicates:
        group = 'fixed' if not obj.parent else obj.parent.name.lower().replace('motion / ', '').replace(' ', '_')
        batch = f"{group}__{obj['source_vpb_material']}"
        totals[batch] += duplicates
        records.append({'name': obj.name, 'batch': batch, 'duplicateFaces': duplicates})
report = {'duplicates': sum(totals.values()), 'byBatch': dict(totals), 'objects': records,
          'method': 'Identical three vertex indices, independent of winding; no vertex weld or distance threshold'}
(OUT / 'duplicate-face-audit.json').write_text(json.dumps(report, indent=2))
print('DUPLICATE_FACE_AUDIT', report['duplicates'], dict(totals), flush=True)
