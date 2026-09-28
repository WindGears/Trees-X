"""Recover opening transforms from matching closed/open source geometry.

No hinges or mechanical specifications are inferred from marketing references.
The rigid transform must reproduce the supplied open pose for every member.
"""
from pathlib import Path
import json
import math
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/reventon'
meshes = json.loads((OUT / 'source/manifest.json').read_text())['meshes']
geometry = np.load(OUT / 'source/geometry.npz')


def recover(closed_layer, open_layer, side=0):
    closed = [m for m in meshes if m['layer'] == closed_layer]
    opened = [m for m in meshes if m['layer'] == open_layer]
    if side:
        closed = [m for m in closed if np.sign(geometry[m['key'] + '_v'][:, 0].mean()) == side]
    pairs = []
    for a in closed:
        A = geometry[a['key'] + '_v'].astype(float)
        candidates = []
        for b in opened:
            B = geometry[b['key'] + '_v'].astype(float)
            if a['material'] != b['material'] or A.shape != B.shape:
                continue
            if side and np.sign(B[:, 0].mean()) != side:
                continue
            ca, cb = A.mean(0), B.mean(0)
            U, _, Vt = np.linalg.svd((A - ca).T @ (B - cb))
            if np.linalg.det(Vt.T @ U.T) < 0:
                Vt[-1] *= -1
            R = Vt.T @ U.T
            t = cb - R @ ca
            error = np.linalg.norm(A @ R.T + t - B, axis=1).max()
            candidates.append((float(error), b['key'], R, t))
        assert candidates, a['key']
        error, target, rotation, translation = min(candidates, key=lambda item: item[0])
        assert error < 0.000001, (a['key'], error)
        pairs.append({'closed': a['key'], 'open': target, 'material': a['material'],
                      'maxError': error, 'rotation': rotation.tolist(), 'translation': translation.tolist()})
    # Large body panel gives the best-conditioned fit. Validate it on all members.
    body = next(pair for pair in pairs if pair['material'] == 'body')
    R, t = np.array(body['rotation']), np.array(body['translation'])
    max_error = 0
    rigid_members, articulated = [], []
    for pair in pairs:
        A, B = (geometry[pair[key] + '_v'] for key in ('closed', 'open'))
        error = float(np.linalg.norm(A @ R.T + t - B, axis=1).max())
        if error < 0.000001:
            rigid_members.append(pair['closed'])
            max_error = max(max_error, error)
        else:
            articulated.append({'key': pair['closed'], 'bodyTransformError': error})
    if side:
        assert not articulated, articulated
    pivot = np.linalg.lstsq(np.eye(3) - R, t, rcond=1e-5)[0]
    angle = math.atan2(R[2, 1], R[1, 1])
    expected = np.array([[1, 0, 0], [0, math.cos(angle), -math.sin(angle)], [0, math.sin(angle), math.cos(angle)]])
    np.testing.assert_allclose(R, expected, atol=1e-6)
    return {'closedLayer': closed_layer, 'openLayer': open_layer, 'side': side,
            'pivotSource': pivot.tolist(), 'angleX': angle, 'angleDegrees': math.degrees(angle),
            'maxGroupVertexError': max_error, 'members': rigid_members, 'articulatedMembers': articulated, 'pairs': pairs,
            'note': 'Matches supplied poses. This is not a verified real-car hinge mechanism.'}


result = {'doors': [recover('DOOR CLOSED', 'DOOR OPEN', side) for side in (-1, 1)],
          'hood': recover('HOOD CLOSED', 'HOOD OPEN'),
          'structureScope': 'Four wheel assemblies, doors and rear cover; visual component separation only.',
          'limitations': ['FRAME has donor-vehicle material names; not an engineering teardown',
                          'Source materials still require visual calibration',
                          'Hood support pieces do not follow the cover rigid transform and require separate linkage work']}
(OUT / 'motion-analysis.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({'doors': [{'members': len(d['members']), 'degrees': d['angleDegrees'], 'error': d['maxGroupVertexError']} for d in result['doors']],
                  'hoodMembers': len(result['hood']['members']), 'hoodDegrees': result['hood']['angleDegrees'],
                  'hoodError': result['hood']['maxGroupVertexError']}))
