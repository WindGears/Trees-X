"""Repair source brushed-metal reflectance on the existing atlas; no new UVs."""
from pathlib import Path
import json
import sys
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bake_realtime_materials as bake
from vpb_cycles_materials import Adapter

records = {row['id']: row for row in json.loads((bake.ROOT / 'artifacts/reventon/source/vpb-graph.json').read_text(encoding='utf-8'))['records']}
adapter = Adapter(records)
for identifier in (15889, 16102):
    directory = bake.OUT / 'materials' / str(identifier)
    path = directory / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    if manifest.get('reflectanceRepair'):
        print('REPAIR_REUSE', identifier, flush=True)
        continue
    (directory / 'before-reflectance-repair.json').write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
    arrays = np.load(directory / 'uv.npz')
    material = adapter.make(identifier)
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    objects = []
    for row in manifest['objects']:
        obj = bpy.data.objects[row['name']]
        layer = obj.data.uv_layers.get('Realtime Bake') or obj.data.uv_layers.new(name='Realtime Bake')
        layer.data.foreach_set('uv', arrays[row['array']].ravel())
        obj.data.uv_layers.active = layer
        layer.active_render = True
        obj.data.materials[0] = material
        objects.append(obj)
    bake.freeze_source_uv(material)
    copies = []
    for obj in objects:
        copy = obj.copy()
        copy.data = obj.data.copy()
        bake.source.objects.link(copy)
        copies.append(copy)
    bake.select(copies)
    bpy.ops.object.join()
    combined = bpy.context.object
    for obj in bpy.data.objects:
        if obj.type == 'MESH': obj.hide_render = obj != combined
    result = bake.bake_channel(material, shader, [combined], 'Base Color', directory, manifest['size'])
    manifest['channels']['Base Color'] = result
    manifest['constants'].pop('Base Color', None)
    manifest['reflectanceRepair'] = 'Original UBrushedMetal reflectivity × specularWeight × gamma-corrected recovered specular image; existing atlas/geometry unchanged'
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    mesh = combined.data
    bpy.data.objects.remove(combined, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    print('REFLECTANCE_REPAIRED', identifier, flush=True)
print('BRAKE_REPAIR_COMPLETE', flush=True)
