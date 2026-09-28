"""Read named material fields only. Does not evaluate the supplied scene."""
from pathlib import Path
import json
import mmap
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts/reventon/source/vpb-decoded.osb'
OUT = SOURCE.with_name('vpb-materials.json')
records = []
with SOURCE.open('rb') as stream:
    data = mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ)
    def integer(p): return struct.unpack_from('>I', data, p)[0]
    def string(p):
        size = integer(p)
        if size > 65536: raise ValueError('Invalid string')
        return data[p+4:p+4+size].rstrip(b'\0').decode('utf-8', 'replace'), p+4+size
    for match in re.finditer(rb'(?:Name|U[A-Za-z]+Material)\x00', data):
        start = match.start()-4
        if integer(start) != len(match.group()): continue
        name, p = string(start)
        record_id = integer(p)
        p += 7  # id, flags, version
        fields = {}
        try:
            for _ in range(600):
                key, p = string(p)
                if not key: break
                typ, p = string(p)
                size = integer(p); p += 4
                if size > 1000000: raise ValueError('Invalid field size')
                raw = data[p:p+size]; p += size
                if typ == 'SFString':
                    encoded=raw[4:].rstrip(b'\0')
                    try: value=encoded.decode('utf-8')
                    except UnicodeDecodeError: value=encoded.decode('gb18030','replace')
                elif typ == 'SFBool': value = bool(raw[0])
                elif typ in ('SFReal32',): value = struct.unpack('>f', raw)[0]
                elif typ in ('SFVec2f', 'SFVec3f', 'SFVec4f', 'SFColor3f', 'SFMatrix'): value = list(struct.unpack('>'+'f'*(len(raw)//4), raw))
                elif len(raw) == 4: value = struct.unpack('>I', raw)[0]
                elif (typ.startswith('MF') or key == 'attachments') and len(raw) >= 4 and (len(raw)-4)%4 == 0:
                    fmt = 'f' if any(x in typ for x in ('Real32', 'Vec', 'Matrix')) else 'I'
                    value = list(struct.unpack('>'+fmt*((len(raw)-4)//4), raw[4:]))
                else: value = raw.hex()
                fields[key] = {'type':typ, 'value':value}
            records.append({'id':record_id,'type':name,'fields':fields})
        except (ValueError, struct.error, IndexError):
            continue
    data.close()
names = {r['id']:r['fields'].get('name',{}).get('value') for r in records if r['type']=='Name'}
materials = []
for record in records:
    if record['type']=='Name': continue
    ids = record['fields'].get('attachments',{}).get('value',[])
    record['names'] = [names[i] for i in ids if i in names]
    materials.append(record)
OUT.write_text(json.dumps({'materials':materials},indent=2),encoding='utf-8')
for r in materials:
    relevant = {k:v['value'] for k,v in r['fields'].items() if ('Map' in k and v['type']=='SFImagePtr') or k in ('diffuseColor','baseColor','roughness','useBumpTexture','useColorTexture','textureSize','bumpType')}
    print(r['id'],r['type'],r['names'],json.dumps(relevant))
