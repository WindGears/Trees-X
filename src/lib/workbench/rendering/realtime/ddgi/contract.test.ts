import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { assertDdgiRevision, createDdgiVolume, ddgiBudget, ddgiSource } from './contract'
import { loungeMotionBounds } from '../../loungeSpatialTable'

describe('reviewed fixed DDGI contract', () => {
  it('covers the audited complete layout and table with exactly sixteen probes on its longest axis', () => {
    const volume = createDdgiVolume()
    expect(volume.res.toArray()).toEqual([16, 9, 10])
    expect(volume.probes).toBe(1440)
    expect(volume.probes * ddgiBudget.raysPerProbe).toBeLessThanOrEqual(ddgiBudget.maxRaysPerTick)
    expect(volume.box.containsPoint(new Vector3(...loungeMotionBounds.min))).toBe(true)
    expect(volume.box.containsPoint(new Vector3(...loungeMotionBounds.max))).toBe(true)
    expect(volume.box.containsPoint(new Vector3(4.2, -2.4792, 2.4))).toBe(true)
    expect(volume.box.containsPoint(new Vector3(-4.2, -2.4792, -2.4))).toBe(true)
    expect(() => createDdgiVolume(Infinity)).toThrow('finite')
    expect(() => assertDdgiRevision('186')).toThrow('reviewed')
    expect(() => assertDdgiRevision('185')).not.toThrow()
  })

  it('pins the exact package and audited pacing, ownership and scene builder implementation', async () => {
    const entry = import.meta.resolve('speedball-gi'),
      packageJson = JSON.parse(await readFile(new URL('../package.json', entry), 'utf8')) as {
        version: string
        license: string
      }
    expect(packageJson).toMatchObject({ version: ddgiSource.version, license: ddgiSource.license })
    for (const [file, expected] of [
      ['gi_probes.js', 'ead4447e38d2e7bb6f325180120df31edb6174d62f3d27ae63ae41b10fa03f68'],
      ['spectral_scene.js', '227ceb050e375074dab1da881d161cfa844553129aa38a8e07f8984ae4f925bb'],
      ['gi_budget.js', 'ec86cb45ca83541bedcd6c3722cda22136cc8a616dd870e92f7062402b464ee2'],
    ]) {
      const bytes = await readFile(new URL(file!, entry))
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(expected)
    }
  })
})
