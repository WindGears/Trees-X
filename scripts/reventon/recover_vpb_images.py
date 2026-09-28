"""Recover embedded OpenSG Image pixels losslessly, with explicit provenance.

No shader, script, or executable in the supplied file is evaluated.
"""
from pathlib import Path
import hashlib
import json
import mmap
import re
import struct
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts/reventon/source/vpb-decoded.osb'
OUTPUT = ROOT / 'artifacts/reventon/textures'
OUTPUT.mkdir(parents=True,exist_ok=True)
records, unique = [], {}
with SOURCE.open('rb') as stream:
    data = mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
    def u32(position): return struct.unpack_from('>I',data,position)[0]
    def string(position):
        size = u32(position)
        if size > 65536: raise ValueError('String length out of bounds')
        return data[position+4:position+4+size].rstrip(b'\0').decode('utf-8','replace'),position+4+size
    for match in re.finditer(b'\x00\x00\x00\x06Image\x00',data):
        _, position = string(match.start())
        image_id = u32(position)
        position += 6
        fields = {}
        while True:
            name, position = string(position)
            if not name: break
            typ, position = string(position)
            size = u32(position);position += 4
            if position+size > len(data): raise ValueError('Field exceeds file')
            fields[name] = (typ,position,size)
            position += size
        def scalar(name): return u32(fields[name][1])
        name, _ = string(fields['name'][1])
        width,height = scalar('width'),scalar('height')
        bpp,kind,sides = scalar('bpp'),scalar('dataType'),scalar('sideCount')
        pixel_pos,pixel_size = fields['pixel'][1:]
        pixels = data[pixel_pos+4:pixel_pos+pixel_size]
        assert len(pixels) == u32(pixel_pos)
        digest = hashlib.sha256(pixels).hexdigest()
        record={'id':image_id,'originalName':name,'width':width,'height':height,
                'bytesPerPixel':bpp,'dataType':kind,'sides':sides,'pixelFormat':scalar('pixelFormat'),
                'mipmaps':scalar('mipMapCount'),'pixelSha256':digest,
                'baseMipSha256':hashlib.sha256(pixels[:width*height*bpp]).hexdigest()}
        if digest in unique:
            record['file']=unique[digest]
        else:
            safe=re.sub(r'[^a-zA-Z0-9_.-]+','_',name.replace('\\','/').split('/')[-1]) or 'unnamed'
            stem=f'{image_id}-{safe}'
            if kind==5121 and sides==1 and bpp in (1,2,3,4):
                mode={1:'L',2:'LA',3:'RGB',4:'RGBA'}[bpp]
                base=pixels[:width*height*bpp]
                image=Image.frombytes(mode,(width,height),base).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                file=OUTPUT/(stem+'.png')
                from PIL.PngImagePlugin import PngInfo
                info=PngInfo();info.add_text('Source',f'User supplied 2 TEMP.vpb, Image {image_id}, {name}; full resolution base mip, bottom-left origin converted to PNG top-left.')
                image.save(file,pnginfo=info)
                record['file']=file.name
            else:
                # Preserve all floating-point/cubemap mip bytes before any interpretation.
                file=OUTPUT/(stem+'.bin')
                file.write_bytes(pixels)
                record['file']=file.name
            unique[digest]=record['file']
        records.append(record)
    data.close()
(OUTPUT/'manifest.json').write_text(json.dumps({'source':'User supplied 2 TEMP.vpb','recordCount':len(records),'uniqueCount':len(unique),'images':records},indent=2),encoding='utf-8')
print(json.dumps({'records':len(records),'unique':len(unique),'files':[r for r in records if next(x for x in records if x['file']==r['file'])==r]},indent=2))
