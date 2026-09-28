"""Convert the recovered OpenGL cubemap base mip to a linear lat-long array."""
from pathlib import Path
import json
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/textures'
record = next(i for i in json.loads((OUT/'manifest.json').read_text())['images'] if i['id']==26515)
data = (OUT/record['file']).read_bytes()
size = record['width']
stride = sum(max(1,size>>level)**2*6 for level in range(record['mipmaps']))
assert len(data)==stride*6
faces = np.stack([np.frombuffer(data,dtype='<f2',count=size*size*3,offset=i*stride).reshape(size,size,3).astype('float32') for i in range(6)])
assert np.isfinite(faces).all() and faces.min()>=0
w,h = 2048,1024
# Blender image buffers start at the bottom; longitude maps to Z-up world directions.
longitude = ((np.arange(w)+0.5)/w*2-1)*np.pi
latitude = ((np.arange(h)+0.5)/h-0.5)*np.pi
u,v = np.meshgrid(longitude,latitude)
x,y,z = np.cos(v)*np.cos(u),np.cos(v)*np.sin(u),np.sin(v)
major = np.argmax(np.stack((abs(x),abs(y),abs(z))),axis=0)
result = np.zeros((h,w,4),dtype='float32'); result[:,:,3]=1
for face,(axis,positive,s,t) in enumerate(((0,True,-z,-y),(0,False,z,-y),(1,True,x,z),(1,False,x,-z),(2,True,x,-y),(2,False,-x,-y))):
    direction = (x,y,z)[axis]
    mask = (major==axis)&((direction>0)==positive)
    denom=abs(direction[mask]); fx=np.clip((s[mask]/denom+1)*0.5*size-0.5,0,size-1);fy=np.clip((t[mask]/denom+1)*0.5*size-0.5,0,size-1)
    ix,iy=fx.astype(int),fy.astype(int); jx,jy=np.minimum(ix+1,size-1),np.minimum(iy+1,size-1)
    a,b=(fx-ix)[:,None],(fy-iy)[:,None]
    result[mask,:3]=(faces[face,iy,ix]*(1-a)*(1-b)+faces[face,iy,jx]*a*(1-b)+faces[face,jy,ix]*(1-a)*b+faces[face,jy,jx]*a*b)
np.save(OUT/'studio-linear.npy',result)
(OUT/'studio-conversion.json').write_text(json.dumps({'sourceImage':record,'faceOrder':'+X,-X,+Y,-Y,+Z,-Z','layout':'six face-major mip chains, little-endian RGB half floats','target':[w,h],'resampling':'bilinear base mip; no exposure applied','orientationStatus':'cubemap conversion verified; final scene rotation is authored'},indent=2))
print('Recovered studio environment',result.shape,float(result[:,:,:3].max()))
