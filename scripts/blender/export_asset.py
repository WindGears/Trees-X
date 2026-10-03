"""Isolated Blender export: never overwrites or saves the input master.

blender --background --factory-startup --python scripts/blender/export_asset.py --
  --input-glb model.glb --output artifacts/version/model.glb
or open a .blend on the Blender command line and use --collection Product.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--input-glb')
parser.add_argument('--collection')
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output).resolve()
if output.exists():
    raise RuntimeError('Choose a new runtime version; output already exists')
master = Path(args.input_glb or bpy.data.filepath).resolve()
if not master.is_file():
    raise RuntimeError('A saved .blend or --input-glb is required')
before = hashlib.sha256(master.read_bytes()).hexdigest()
if args.input_glb:
    bpy.ops.import_scene.gltf(filepath=str(master))
    imported = list(bpy.context.selected_objects)
else:
    collection = bpy.data.collections.get(args.collection) if args.collection else bpy.context.scene.collection
    if collection is None:
        raise RuntimeError('Product collection not found')
    imported = list(collection.all_objects)
if not any(obj.type == 'MESH' for obj in imported):
    raise RuntimeError('No mesh objects selected for export')
bpy.ops.object.select_all(action='DESELECT')
for obj in imported:
    obj.select_set(True)
missing = [image.filepath for image in bpy.data.images if image.source == 'FILE' and not image.packed_file
           and image.filepath and not Path(bpy.path.abspath(image.filepath)).is_file()]
if missing:
    raise RuntimeError('Missing source textures: ' + ', '.join(missing))
report = {
    'blenderVersion': bpy.app.version_string,
    'source': str(master), 'sourceSha256': before,
    'runtime': str(output), 'qualityApproved': False,
    'objects': [{'name': obj.name, 'type': obj.type, 'parent': obj.parent.name if obj.parent else None,
                 'location': list(obj.location), 'rotationQuaternion': list(obj.rotation_euler.to_quaternion()),
                 'scale': list(obj.scale),
                 'uvLayers': [layer.name for layer in obj.data.uv_layers] if obj.type == 'MESH' else [],
                 'materials': [slot.material.name if slot.material else None for slot in obj.material_slots]}
                for obj in imported],
    'workflow': 'Preserve nodes, local pivots, UV and materials; no transform application, joining or decimation',
    'review': 'Verify names, normals, UV, PBR maps, motion pivots and browser appearance before publishing',
}
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_animations=True,
    export_cameras=False, export_lights=False, export_materials='EXPORT')
after = hashlib.sha256(master.read_bytes()).hexdigest()
if before != after:
    raise RuntimeError('Input master changed unexpectedly')
report['runtimeSha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
report['masterUnchanged'] = True
output.with_suffix('.production.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'output': str(output), 'objects': len(imported), 'masterUnchanged': True}))
