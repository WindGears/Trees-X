"""Read, never modify, VRED camera metadata retained in the supplied JPEGs."""
from pathlib import Path
import json,xml.etree.ElementTree as ET
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
records={}
for path in sorted((ROOT/'lamborghini-reventon-re-made-1.snapshot.2').glob('*.jpg')):
    with Image.open(path) as image:
        record={'dimensions':list(image.size),'software':image.getexif().get(305),'vred':{}}
        if 'xmp' in image.info:
            for element in ET.fromstring(image.info['xmp']).iter():
                for key,value in element.attrib.items():
                    if 'ns.autodesk.com' in key:record['vred'][key]=value
    records[path.name]=record
out=ROOT/'artifacts/reventon/source/reference-metadata.json'
out.write_text(json.dumps(records,indent=2),encoding='utf-8')
print('Saved metadata from',len(records),'reference photographs')
