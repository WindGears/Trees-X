"""Match source triangles to VPB surfaces and retain per-corner recovered UVs."""
from pathlib import Path
import json
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon/source'


def keys(points):
    quantized = np.rint(points * 1000000).astype('int32')
    order = np.lexsort((quantized[:, :, 2], quantized[:, :, 1], quantized[:, :, 0]), axis=1)
    ordered = np.take_along_axis(quantized, order[:, :, None], axis=1)
    return np.ascontiguousarray(ordered).reshape(-1, 9).view('V36').ravel(), order


def main():
    graph = json.loads((OUT / 'vpb-graph.json').read_text(encoding='utf-8'))
    records = {r['id']: r for r in graph['records']}
    arrays = np.load(OUT / 'vpb-arrays.npz')
    key_parts, uv_parts, material_parts, geometry_parts, point_parts = [], [], [], [], []
    skipped = []
    vertex_points, vertex_uv, vertex_geometry = [], [], []
    geometry_material = {}
    for geometry in graph['geometries']:
        fields = geometry['fields']
        types = arrays[str(fields['types'])]
        transform = np.array(records[fields['transform']]['fields']['matrix']).reshape(4, 4).T
        if not np.all(types == 4) or not np.allclose(transform, np.eye(4), atol=1e-6):
            skipped.append({'id': geometry['id'], 'reason': 'non-triangle primitive or nonidentity local transform'})
            continue
        positions = arrays[str(fields['positions'])]
        if not np.isfinite(positions).all() or np.abs(positions).max() > 20:
            skipped.append({'id': geometry['id'], 'reason': 'outside original vehicle coordinate bounds'})
            continue
        indices = arrays[str(fields['indices'])].astype('int32').reshape(-1, 3)
        assert indices.max() < len(positions)
        points = positions[indices]
        key, order = keys(points)
        uv = arrays[str(fields['texCoords'])]
        assert len(uv) == len(positions)
        vertex_points.append(positions)
        vertex_uv.append(uv)
        vertex_geometry.append(np.full(len(positions), geometry['id'], dtype='int32'))
        geometry_material[geometry['id']] = fields['material']
        key_parts.append(key)
        point_parts.append(np.take_along_axis(points, order[:, :, None], axis=1))
        uv_parts.append(np.take_along_axis(uv[indices], order[:, :, None], axis=1))
        material_parts.append(np.full(len(key), fields['material'], dtype='int32'))
        geometry_parts.append(np.full(len(key), geometry['id'], dtype='int32'))
    all_keys = np.concatenate(key_parts)
    all_uv = np.concatenate(uv_parts)
    all_points = np.concatenate(point_parts)
    all_materials = np.concatenate(material_parts)
    all_geometries = np.concatenate(geometry_parts)
    order = np.argsort(all_keys)
    sorted_keys = all_keys[order]
    vp = np.concatenate(vertex_points)
    vu = np.concatenate(vertex_uv)
    vg = np.concatenate(vertex_geometry)
    vk = np.ascontiguousarray(np.rint(vp * 1000000).astype('int32')).view('V12').ravel()
    vo = np.argsort(vk)
    vk = vk[vo]

    def corner_matches(positions):
        """Reject a corner if one VPB surface gives it multiple different UVs."""
        query = np.ascontiguousarray(np.rint(positions * 1000000).astype('int32')).view('V12').ravel()
        lows = np.searchsorted(vk, query)
        highs = np.searchsorted(vk, query, side='right')
        result = []
        for point, lo, hi in zip(positions, lows, highs):
            matches, conflicts = {}, set()
            for index in vo[lo:hi]:
                if np.max(np.abs(vp[index] - point)) > 0.000001:
                    continue
                geometry = int(vg[index])
                previous = matches.get(geometry)
                if previous is not None and np.max(np.abs(vu[previous] - vu[index])) > 1e-5:
                    conflicts.add(geometry)
                matches[geometry] = index
            result.append({g: i for g, i in matches.items() if g not in conflicts})
        return result
    manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
    source = np.load(OUT / 'geometry.npz')
    outputs, meshes = {}, []
    for mesh in manifest['meshes']:
        key = mesh['key']
        points = source[key + '_v'][source[key + '_f']]
        source_keys, corner_order = keys(points)
        low = np.searchsorted(sorted_keys, source_keys)
        high = np.searchsorted(sorted_keys, source_keys, side='right')
        matched = high > low
        ids = order[np.minimum(low, len(order) - 1)]
        uv = np.take_along_axis(all_uv[ids], np.argsort(corner_order, axis=1)[:, :, None], axis=1)
        matched_points = np.take_along_axis(all_points[ids], np.argsort(corner_order, axis=1)[:, :, None], axis=1)
        error = np.max(np.abs(matched_points - points), axis=(1, 2))
        matched &= error <= 0.000001
        ambiguous = np.zeros(len(points), dtype=bool)
        for face in np.flatnonzero(high - low > 1):
            alternatives = order[low[face]:high[face]]
            if np.any(all_materials[alternatives] != all_materials[ids[face]]):
                ambiguous[face] = True
            elif not np.allclose(all_uv[alternatives], all_uv[ids[face]], atol=1e-5):
                ambiguous[face] = True
        matched &= ~ambiguous
        materials = np.where(matched, all_materials[ids], 0)
        uv[~matched] = source[key + '_uv'][source[key + '_f'][~matched]]
        assigned_geometry = np.where(matched, all_geometries[ids], 0)
        # Rhino and VRED can triangulate the same original quad differently.
        # Accept only triangles whose three corners belong to the SAME VPB surface.
        fallback = 0
        if not matched.all():
            corners = corner_matches(source[key + '_v'])
            for face in np.flatnonzero(~matched & ~ambiguous):
                a, b, c = (corners[i] for i in source[key + '_f'][face])
                common = set(a).intersection(b, c)
                if not common:
                    continue
                if len({geometry_material[g] for g in common}) != 1:
                    continue
                variants = [vu[[a[g], b[g], c[g]]] for g in sorted(common)]
                if not all(np.max(np.abs(v - variants[0])) <= 1e-5 for v in variants):
                    continue
                geometry = min(common)
                uv[face] = variants[0]
                materials[face] = geometry_material[geometry]
                assigned_geometry[face] = geometry
                matched[face] = True
                error[face] = np.max(np.abs(vp[[a[geometry], b[geometry], c[geometry]]] - points[face]))
                fallback += 1
        outputs[key + '_materials'] = materials
        outputs[key + '_uv'] = uv
        outputs[key + '_geometry'] = assigned_geometry
        unique, counts = np.unique(materials, return_counts=True)
        meshes.append({'key': key, 'sourceMaterial': mesh['material'], 'matched': int(matched.sum()),
                       'total': len(points), 'ambiguous': int(ambiguous.sum()), 'sameSurfaceCornerMatches': fallback,
                       'maxCoordinateError': float(error[matched].max()) if matched.any() else None,
                       'materials': {str(m): int(n) for m, n in zip(unique, counts)}})
    np.savez_compressed(OUT / 'vpb-surface-bindings.npz', **outputs)
    report = {'method': 'Exact triangles, then same-surface corner matches for alternate triangulation; coordinates checked <=1e-6; material/UV conflicts discarded',
              'matched': sum(m['matched'] for m in meshes), 'total': sum(m['total'] for m in meshes),
              'ambiguous': sum(m['ambiguous'] for m in meshes), 'skippedVpbGeometry': skipped, 'meshes': meshes}
    (OUT / 'vpb-surface-bindings.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('meshes', 'skippedVpbGeometry')}))
    for key in ('m335', 'm394', 'm363', 'm586'):
        print(next(m for m in meshes if m['key'] == key))


if __name__ == '__main__':
    main()
