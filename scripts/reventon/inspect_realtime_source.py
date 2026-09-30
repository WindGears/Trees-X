"""Read-only inventory for genuine Blender-to-WebGL texture baking, not video."""
from pathlib import Path
import collections
import hashlib
import json
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/realtime'
OUT.mkdir(exist_ok=True)
assert bpy.app.background
assert Path(bpy.data.filepath).name == 'reventon-vpb-film.blend'
scene = bpy.context.scene
scene.frame_set(1)
source = bpy.data.collections['VPB / Source-bound look candidate']
groups = collections.defaultdict(lambda: {'objects': 0, 'triangles': 0, 'materials': set()})
materials = {}
for obj in source.objects:
    group = obj.parent.name if obj.parent else 'Body / fixed'
    obj.data.calc_loop_triangles()
    triangles = len(obj.data.loop_triangles)
    groups[group]['objects'] += 1
    groups[group]['triangles'] += triangles
    assert len(obj.data.materials) == 1
    mat = obj.data.materials[0]
    identifier = mat['source_vpb_material_id']
    groups[group]['materials'].add(identifier)
    if identifier not in materials:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        sockets = {}
        for name in ('Base Color', 'Roughness', 'Metallic', 'Normal', 'Alpha', 'Transmission Weight', 'IOR', 'Coat Weight'):
            socket = bsdf.inputs.get(name)
            if socket is None:
                continue
            value = socket.default_value
            sockets[name] = {'linked': socket.is_linked,
                             'value': float(value) if isinstance(value, (float, int)) else list(value)}
        materials[identifier] = {'name': mat.name, 'sourceType': mat.get('source_type'),
                                 'sourceNames': mat.get('source_names'), 'objects': 0, 'triangles': 0,
                                 'channels': sockets, 'images': [], 'usesObjectProjection': False,
                                 'uvLayers': set(), 'representative': None, 'groups': set()}
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                materials[identifier]['images'].append({'name': node.image.name, 'size': list(node.image.size),
                                                        'projection': node.projection, 'colorSpace': node.image.colorspace_settings.name})
            if node.type == 'TEX_COORD' and node.outputs['Object'].is_linked:
                materials[identifier]['usesObjectProjection'] = True
    entry = materials[identifier]
    entry['objects'] += 1
    entry['triangles'] += triangles
    entry['uvLayers'].update(layer.name for layer in obj.data.uv_layers)
    entry['groups'].add(group)
    if not entry['representative'] or entry['representative']['triangles'] < triangles:
        entry['representative'] = {'name': obj.name, 'triangles': triangles, 'group': group}
for entry in materials.values():
    entry['uvLayers'] = sorted(entry['uvLayers'])
    entry['groups'] = sorted(entry['groups'])
for entry in groups.values():
    entry['materials'] = sorted(entry['materials'])
export_api = {p.identifier: p.type for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
report = {'sourceBlend': bpy.data.filepath, 'sourceSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          'objects': len(source.objects), 'triangles': sum(g['triangles'] for g in groups.values()),
          'motionGroups': dict(groups), 'potentialMaterialBatches': sum(len(g['materials']) for g in groups.values()),
          'materials': materials, 'exportOperator': export_api,
          'scope': 'Read-only inventory; no baking or realtime quality approval yet'}
(OUT / 'source-inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('REALTIME_INVENTORY', report['objects'], report['triangles'], report['potentialMaterialBatches'], flush=True)
