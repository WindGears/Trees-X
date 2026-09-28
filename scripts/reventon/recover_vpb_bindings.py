"""Read OpenSG scene bindings without evaluating any code from the supplied asset.

Geometry matching uses source coordinates, not guessed material-name similarity.
Unmatched or ambiguous meshes remain explicit in the report.
"""
from pathlib import Path
import json
import mmap
import re
import struct
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/source'


def recover():
    records, arrays = {}, {}
    with (OUT / 'vpb-decoded.osb').open('rb') as stream:
        data = mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ)

        def integer(p):
            return struct.unpack_from('>I', data, p)[0]

        def string(p):
            size = integer(p)
            if not 1 <= size <= 65536 or data[p + 3 + size] != 0:
                raise ValueError('Invalid string')
            return data[p + 4:p + 3 + size].decode('utf-8'), p + 4 + size

        pattern = rb'(?:Node|Geometry|Geo[A-Za-z0-9]+|Transform3D|MaterialGroup|Name|ColorComponents|ColorComponentSettings|TextureSettings)\x00'
        for match in re.finditer(pattern, data):
            if integer(match.start() - 4) != len(match.group()):
                continue
            kind, header = string(match.start() - 4)
            identifier = integer(header)
            for offset in (7, 6):
                fields = {}
                try:
                    p = header + offset
                    for _ in range(160):
                        key, p = string(p)
                        if not key:
                            break
                        typ, p = string(p)
                        size = integer(p)
                        p += 4
                        if size > 16000000:
                            raise ValueError('Invalid size')
                        raw = data[p:p + size]
                        p += size
                        if typ == 'SFString':
                            value = raw[4:].rstrip(b'\0').decode('gb18030', 'replace')
                        elif typ == 'SFBool':
                            value = bool(raw[0])
                        elif typ in ('SFVec2f', 'SFVec3f', 'SFVec4f', 'SFMatrix', 'SFQuaternion', 'SFReal32'):
                            value = list(struct.unpack('>' + 'f' * (len(raw) // 4), raw))
                        elif typ in ('MFPnt3f', 'MFVec3f', 'MFVec2f'):
                            dimension = 2 if typ == 'MFVec2f' else 3
                            values = np.frombuffer(raw, dtype='>f4', offset=4).astype('float32').reshape(-1, dimension)
                            assert len(values) == struct.unpack_from('>I', raw)[0]
                            arrays[str(identifier)] = values
                            value = {'count': len(values), 'min': values.min(axis=0).tolist(), 'max': values.max(axis=0).tolist()}
                        elif kind.startswith('Geo') and typ in ('MFUInt32', 'MFUInt16', 'MFUInt8'):
                            dtype = {'MFUInt32': '>u4', 'MFUInt16': '>u2', 'MFUInt8': 'u1'}[typ]
                            values = np.frombuffer(raw, dtype=dtype, offset=4).copy()
                            assert len(values) == struct.unpack_from('>I', raw)[0]
                            arrays[str(identifier)] = values
                            value = {'count': len(values), 'first': values[:20].tolist()}
                        elif len(raw) == 4:
                            value = struct.unpack('>I', raw)[0]
                        elif (typ.startswith('MF') or key == 'attachments') and (len(raw) - 4) % 4 == 0:
                            value = list(struct.unpack('>' + 'I' * ((len(raw) - 4) // 4), raw[4:]))
                        else:
                            value = raw.hex()
                        fields[key] = value
                    if not fields:
                        raise ValueError('Empty record')
                    records[identifier] = {'id': identifier, 'type': kind, 'fields': fields}
                    break
                except (ValueError, UnicodeDecodeError, struct.error, IndexError):
                    continue
        data.close()
    names = {r['id']: r['fields']['name'] for r in records.values() if r['type'] == 'Name'}
    geometry_nodes = {}
    for r in records.values():
        if r['type'] == 'Node':
            r['names'] = [names[i] for i in r['fields'].get('attachments', []) if i in names]
            geometry_nodes.setdefault(r['fields'].get('core'), []).append(r)
    geometries = []
    for r in records.values():
        if r['type'] != 'Geometry':
            continue
        r['nodes'] = [{'id': n['id'], 'names': n['names']} for n in geometry_nodes.get(r['id'], [])]
        values = arrays.get(str(r['fields'].get('positions')))
        if values is not None:
            r['bounds'] = [values.min(axis=0).tolist(), values.max(axis=0).tolist()]
            r['vertices'] = len(values)
        geometries.append(r)
    (OUT / 'vpb-graph.json').write_text(json.dumps({'records': list(records.values()), 'geometries': geometries}, ensure_ascii=False, indent=2), encoding='utf-8')
    np.savez_compressed(OUT / 'vpb-arrays.npz', **arrays)
    print(json.dumps({'records': len(records), 'geometries': len(geometries), 'arrays': len(arrays)}))


if __name__ == '__main__':
    recover()
