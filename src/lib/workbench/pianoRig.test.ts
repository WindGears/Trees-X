import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePianoRig, samplePianoCurve, type PianoRig } from './pianoRig'

function fixture(): PianoRig {
  return {
    version: 1,
    type: 'piano-sound-path-v1',
    clip: 'piano-sound-path',
    duration: 7,
    sampleStep: 0.01,
    parts: [
      {
        id: 'key',
        node: 'piano-part-key',
        name: 'Key assembly',
        layer: 'keyboard',
        section: ['section-key'],
        flat: ['flat-key'],
        restPoint: [1, 2, 3],
      },
    ],
    curves: [Array.from({ length: 701 }, (_, i) => i / 700)],
    surfaces: [
      { node: 'section-key', curves: [0], line: false, castShadow: true },
      { node: 'flat-key', curves: [0], line: false, castShadow: true },
    ],
  }
}

describe('piano motion rig', () => {
  it('parses the actual recovered rig with its registered semantic parts and samples', () => {
    const rig = parsePianoRig(
      JSON.parse(readFileSync('public/models/bundles/kimi-piano/v1/rig.json', 'utf8')) as unknown,
    )
    expect(rig.parts).toHaveLength(823)
    expect(rig.surfaces.length).toBeGreaterThan(5000)
    expect(rig.curves.some((curve) => new Set(curve).size > 2)).toBe(true)
    for (const curve of rig.curves) {
      expect(samplePianoCurve(curve, 0)).toBe(curve[0])
      expect(samplePianoCurve(curve, 1)).toBe(curve[700])
    }
  })

  it('interpolates subframe opacity and clamps both endpoints', () => {
    const curve = Array<number>(701).fill(0)
    curve[0] = 0.1
    curve[14] = 0.2
    curve[15] = 0.8
    curve[700] = 0.9
    expect(samplePianoCurve(curve, 14.25 / 700)).toBeCloseTo(0.35, 13)
    expect(samplePianoCurve(curve, 14.5 / 700)).toBeCloseTo(0.5, 13)
    expect(samplePianoCurve(curve, -0.2)).toBe(0.1)
    expect(samplePianoCurve(curve, 1.2)).toBe(0.9)
    const forward = Array.from({ length: 101 }, (_, i) => samplePianoCurve(curve, i / 100))
    for (let i = 100; i >= 0; i--) expect(samplePianoCurve(curve, i / 100)).toBe(forward[i])
  })

  it.each([
    ['wrong version', (rig: PianoRig) => ({ ...rig, version: 2 })],
    ['unregistered program', (rig: PianoRig) => ({ ...rig, type: 'execute-js' })],
    ['wrong clip', (rig: PianoRig) => ({ ...rig, clip: 'other-animation' })],
    ['wrong duration', (rig: PianoRig) => ({ ...rig, duration: 6.5 })],
    ['wrong sampling interval', (rig: PianoRig) => ({ ...rig, sampleStep: 0.02 })],
    ['no parts', (rig: PianoRig) => ({ ...rig, parts: [] })],
    [
      'duplicate IDs',
      (rig: PianoRig) => ({ ...rig, parts: [rig.parts[0], { ...rig.parts[0], node: 'other' }] }),
    ],
    [
      'duplicate nodes',
      (rig: PianoRig) => ({ ...rig, parts: [rig.parts[0], { ...rig.parts[0], id: 'other' }] }),
    ],
    [
      'nonfinite rest point',
      (rig: PianoRig) => ({ ...rig, parts: [{ ...rig.parts[0], restPoint: [0, Number.NaN, 0] }] }),
    ],
    [
      'missing surface reference',
      (rig: PianoRig) => ({ ...rig, parts: [{ ...rig.parts[0], section: ['missing'] }] }),
    ],
    ['no opacity curves', (rig: PianoRig) => ({ ...rig, curves: [] })],
    ['short opacity curve', (rig: PianoRig) => ({ ...rig, curves: [rig.curves[0]!.slice(1)] })],
    [
      'opacity below zero',
      (rig: PianoRig) => ({ ...rig, curves: [[-0.01, ...rig.curves[0]!.slice(1)]] }),
    ],
    [
      'opacity above one',
      (rig: PianoRig) => ({ ...rig, curves: [[1.01, ...rig.curves[0]!.slice(1)]] }),
    ],
    [
      'nonfinite opacity',
      (rig: PianoRig) => ({
        ...rig,
        curves: [[Number.POSITIVE_INFINITY, ...rig.curves[0]!.slice(1)]],
      }),
    ],
    ['no surfaces', (rig: PianoRig) => ({ ...rig, surfaces: [] })],
    [
      'duplicate surfaces',
      (rig: PianoRig) => ({ ...rig, surfaces: [rig.surfaces[0], rig.surfaces[0]] }),
    ],
    [
      'missing curve',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], curves: [1] }] }),
    ],
    [
      'fractional curve index',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], curves: [0.5] }] }),
    ],
    [
      'negative curve index',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], curves: [-1] }] }),
    ],
    [
      'no curve references',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], curves: [] }] }),
    ],
    [
      'nonboolean line flag',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], line: 'false' }] }),
    ],
    [
      'nonboolean shadow flag',
      (rig: PianoRig) => ({ ...rig, surfaces: [{ ...rig.surfaces[0], castShadow: 1 }] }),
    ],
  ] as const)('rejects %s', (_label, change) => {
    expect(() => parsePianoRig(change(fixture()))).toThrow()
  })
})
