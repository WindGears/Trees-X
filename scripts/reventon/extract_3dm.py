"""Extract the supplied Rhino mesh data without decimation or texture invention.

Run with workspace Python; rhino3dm is isolated in artifacts/reventon/tooling.
The neutral NPZ cache can be read by Blender's bundled NumPy without an addon.
"""
from pathlib import Path
import collections
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'artifacts/reventon/tooling'))
import numpy as np
import rhino3dm as rhino

SOURCE = ROOT / 'lamborghini-reventon-re-made-1.snapshot.2/CR1.3dm'
OUTPUT = ROOT / 'artifacts/reventon/source'
OUTPUT.mkdir(parents=True, exist_ok=True)
doc = rhino.File3dm.Read(str(SOURCE))
if doc is None:
    raise RuntimeError('Rhino source did not load')

arrays, meshes, omitted = {}, [], []
materials, texture_references = {}, collections.defaultdict(set)
for index, material in enumerate(doc.Materials):
    materials[index] = {'name': material.Name, 'diffuse': list(material.DiffuseColor)}
    for method in ('GetBitmapTexture', 'GetBumpTexture', 'GetTransparencyTexture', 'GetEnvironmentTexture'):
        texture = getattr(material, method)()
        if texture:
            texture_references[texture.FileName].add(material.Name)

def extract(mesh, obj, source_index, face_index=None):
    key = f'm{len(meshes)}'
    vertices = np.array([(v.X, v.Y, v.Z) for v in mesh.Vertices], dtype=np.float32)
    faces = []
    for a, b, c, d in mesh.Faces:
        faces.append((a, b, c))
        if c != d:
            faces.append((a, c, d))
    arrays[key + '_v'] = vertices
    arrays[key + '_f'] = np.asarray(faces, dtype=np.int32)
    arrays[key + '_n'] = np.asarray([(v.X, v.Y, v.Z) for v in mesh.Normals], dtype=np.float32)
    arrays[key + '_uv'] = np.asarray([(v.X, v.Y) for v in mesh.TextureCoordinates], dtype=np.float32)
    attributes = obj.Attributes
    layer = doc.Layers[attributes.LayerIndex]
    material = materials.get(attributes.MaterialIndex, {'name': 'UNASSIGNED'})
    meshes.append({
        'key': key, 'sourceIndex': source_index, 'brepFace': face_index,
        'sourceObjectId': str(attributes.Id), 'name': attributes.Name,
        'materialIndex': attributes.MaterialIndex, 'material': material['name'],
        'layerIndex': attributes.LayerIndex, 'layer': layer.Name,
        'visible': attributes.Visible and layer.Visible,
        'vertices': len(vertices), 'triangles': len(faces),
        'uvCount': len(mesh.TextureCoordinates), 'normalCount': len(mesh.Normals),
        'bounds': [vertices.min(axis=0).tolist(), vertices.max(axis=0).tolist()],
    })

for index, obj in enumerate(doc.Objects):
    geometry = obj.Geometry
    if isinstance(geometry, rhino.Mesh):
        extract(geometry, obj, index)
    elif isinstance(geometry, rhino.Brep):
        for face_index, face in enumerate(geometry.Faces):
            mesh = face.GetMesh(rhino.MeshType.Render)
            if mesh and len(mesh.Vertices):
                extract(mesh, obj, index, face_index)
            else:
                omitted.append({'sourceIndex': index, 'brepFace': face_index, 'reason': 'no cached render mesh'})
    else:
        omitted.append({'sourceIndex': index, 'reason': type(geometry).__name__})

np.savez_compressed(OUTPUT / 'geometry.npz', **arrays)
manifest = {
    'source': str(SOURCE.relative_to(ROOT)),
    'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'declaredUnits': str(doc.Settings.ModelUnitSystem),
    'coordinatePolicy': 'Unscaled source coordinates, Z up; declared units conflict with car-sized numeric bounds. No physical dimension claim.',
    'sourceObjects': len(doc.Objects), 'meshObjects': len(meshes),
    'vertices': sum(m['vertices'] for m in meshes),
    'triangles': sum(m['triangles'] for m in meshes),
    'embeddedFiles': list(doc.EmbeddedFilePaths()),
    'externalTextures': [{'path': p, 'materials': sorted(names), 'exists': Path(p).is_file()} for p, names in texture_references.items()],
    'materials': materials, 'meshes': meshes, 'omitted': omitted,
}
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: manifest[k] for k in ('sourceObjects', 'meshObjects', 'vertices', 'triangles', 'omitted', 'externalTextures')}, ensure_ascii=False))
if omitted:
    raise RuntimeError('Extraction incomplete: see manifest')
