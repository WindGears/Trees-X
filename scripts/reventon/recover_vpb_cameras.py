"""Recover camera and tone metadata without interpreting scene scripts."""
from pathlib import Path
import struct,json,re,mmap
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/reventon/source'
records=[]
with (OUT/'vpb-decoded.osb').open('rb') as f:
    d=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
    def u32(p):return struct.unpack_from('>I',d,p)[0]
    def string(p):
        n=u32(p)
        if n>65536:raise ValueError('Not a string')
        return d[p+4:p+4+n].rstrip(b'\0').decode('utf-8','replace'),p+4+n
    for m in re.finditer(rb'(?:CameraAttachment|CameraSetting|TonemappingSettings|Transform3D)\x00',d):
        if u32(m.start()-4)!=len(m.group()):continue
        typ,p=string(m.start()-4);identifier=u32(p)
        if typ=='Transform3D' and identifier not in (15002,23007):continue
        for header in (6,7,8):
            fields={};pos=p+header
            try:
                for _ in range(300):
                    key,pos=string(pos)
                    if not key:break
                    ft,pos=string(pos);size=u32(pos);pos+=4
                    if size>100000:raise ValueError('Invalid field size')
                    raw=d[pos:pos+size];pos+=size
                    if ft=='SFString':val=raw[4:].rstrip(b'\0').decode('utf-8','replace')
                    elif ft=='SFBool':val=bool(raw[0])
                    elif ft=='SFReal64':val=struct.unpack('>d',raw)[0]
                    elif ft in ('SFReal32','SFVec2f','SFVec3f','SFVec4f','SFMatrix','SFQuaternion','SFColor3f','SFPnt3f'):
                        val=list(struct.unpack('>'+'f'*(len(raw)//4),raw))
                    elif len(raw)==4:val=u32(pos-size)
                    else:val=raw.hex()
                    fields[key]={'type':ft,'value':val}
                if fields:
                    records.append({'id':identifier,'type':typ,'fields':fields});break
            except (ValueError,IndexError,struct.error):continue
    d.close()
(OUT/'vpb-cameras.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
for r in records:
    if r['type']=='CameraSetting':print(r['id'],{k:v['value'] for k,v in r['fields'].items() if k in ('from','at','fieldOfView','sensorWidth','sensorHeight')})
print('records',len(records))
