"""Verify full geometry preservation and exported pixel fidelity against manifests."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/reventon'
source=json.loads((OUT/'source/manifest.json').read_text())
geometry=np.load(OUT/'source/geometry.npz')
vertices=triangles=0
for mesh in source['meshes']:
    key=mesh['key'];v,f,uv,n=(geometry[key+s] for s in ('_v','_f','_uv','_n'))
    assert f.min()>=0 and f.max()<len(v),key
    assert f.shape[1]==3 and uv.shape==(len(v),2) and n.shape==(len(v),3),key
    assert all(np.isfinite(x).all() for x in (v,uv,n)),key
    vertices+=len(v);triangles+=len(f)
assert vertices==source['vertices']==733374
assert triangles==source['triangles']==1027841
assert len(source['meshes'])==618
textures=json.loads((OUT/'textures/manifest.json').read_text())
checked=set();exported=[]
for record in textures['images']:
    path=OUT/'textures'/record['file']
    if path in checked:continue
    checked.add(path)
    if record['dataType']==5121 and record['sides']==1:
        with Image.open(path) as image:
            assert image.size==(record['width'],record['height'])
            raw=image.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes()
        assert hashlib.sha256(raw).hexdigest()==record['baseMipSha256'],path
    else:
        assert hashlib.sha256(path.read_bytes()).hexdigest()==record['pixelSha256'],path
    exported.append({'file':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
environment=np.load(OUT/'textures/studio-linear.npy')
assert np.isfinite(environment).all() and environment[:,:,:3].min()>=0 and environment[:,:,:3].max()>1
report={'result':'PASS','meshes':618,'vertices':vertices,'triangles':triangles,
        'uniquePixelPayloadsVerified':len(checked),'sourceImageRecords':len(textures['images']),
        'environmentShape':list(environment.shape),'exportedFiles':exported,
        'scope':'Geometry/index/UV integrity and pixel recovery only. Not a visual-quality approval.'}
(OUT/'recovery-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='exportedFiles'}))
