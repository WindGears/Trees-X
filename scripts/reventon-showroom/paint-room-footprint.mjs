import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { Vector3 } from 'three'

const directory = 'artifacts/car-showroom/composition-r13'
const report = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'))
// r13/r14 share this room and all sampled product/camera transforms.
const bounds = [
  [-6, -0.01, -7],
  [6, 3.8, 7],
]
const names = [
  ['left', 'right'],
  ['floor', 'ceiling'],
  ['front', 'rear'],
]
const result = []
for (const shot of report.shots.filter((shot) => shot.stateName === 'whole')) {
  const footprint = JSON.parse(
    await readFile(`${directory}/${shot.view.id}-footprint.json`, 'utf8'),
  )
  const eye = new Vector3(...shot.target.position)
  const groups = {}
  for (const [name, group] of Object.entries(footprint.groups)) {
    const areas = Object.fromEntries(names.flat().map((face) => [face, 0]))
    const wallHeights = [0, 0, 0, 0]
    for (const sample of group.samples) {
      const p = new Vector3(...sample.center)
      const ray = p
        .clone()
        .sub(eye)
        .normalize()
        .reflect(new Vector3(...sample.normal))
      let distance = Infinity,
        face = null,
        axisHit = null
      const components = ray.toArray()
      for (let axis = 0; axis < 3; axis++) {
        const d = components[axis]
        if (Math.abs(d) < 1e-10) continue
        const side = d > 0 ? 1 : 0
        const t = (bounds[side][axis] - sample.center[axis]) / d
        if (t > 0 && t < distance) {
          distance = t
          face = names[axis][side]
          axisHit = axis
        }
      }
      assert.ok(face && Number.isFinite(distance))
      areas[face] += sample.area
      if (axisHit !== 1) {
        const height = p.y + ray.y * distance
        wallHeights[Math.max(0, Math.min(3, Math.floor(height)))] += sample.area
      }
    }
    groups[name] = {
      roomFaceFraction: Object.fromEntries(
        Object.entries(areas).map(([face, area]) => [face, area / group.projectedArea]),
      ),
      wallHeightFractions: wallHeights.map((area) => area / group.projectedArea),
    }
  }
  result.push({ view: shot.view.id, groups })
}
await writeFile(
  `${directory}/room-footprints.json`,
  JSON.stringify(
    {
      caveat:
        'Unoccluded front-facing triangle projected area with interpolated normals. Not visible-pixel coverage, BRDF integration or a brightness metric. Wall bins are [0,1), [1,2), [2,3), [3,3.8].',
      bounds,
      result,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify(
    result.map(({ view, groups }) => ({ view, sidePaint: groups.sidePaint })),
    null,
    2,
  ),
)
