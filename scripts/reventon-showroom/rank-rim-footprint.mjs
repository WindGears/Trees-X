import { readFile, writeFile } from 'node:fs/promises'
import { Vector3 } from 'three'

const directory = 'artifacts/car-showroom/composition-r13'
const report = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'))
const views = []
for (const shot of report.shots.filter((shot) => shot.stateName === 'whole')) {
  const footprint = JSON.parse(
    await readFile(`${directory}/${shot.view.id}-footprint.json`, 'utf8'),
  )
  const eye = new Vector3(...shot.target.position)
  const groups = Object.fromEntries(
    Object.entries(footprint.groups).map(([key, group]) => [
      key,
      {
        area: group.projectedArea,
        samples: group.samples.map((sample) => {
          const point = new Vector3(...sample.center)
          const ray = point
            .clone()
            .sub(eye)
            .normalize()
            .reflect(new Vector3(...sample.normal))
          const distance = (6.86 - point.z) / ray.z
          return {
            area: sample.area,
            hit: distance > 0 ? point.addScaledVector(ray, distance).toArray() : null,
          }
        }),
      },
    ]),
  )
  views.push({ id: shot.view.id, groups })
}
const candidates = []
const placements = []
// Same emitting area as the existing 1.1 x 2.8 side panel; no flux increase.
for (let x = -3.5; x <= 3.5; x += 0.5)
  for (let y = 1; y <= 3.25; y += 0.25) placements.push({ x, y, width: 4.4, height: 0.7 })
// One visual correction to clear the default description, not a new coarse search.
placements.push({ x: -3.75, y: 2.25, width: 3.5, height: 0.88, corrected: true })
for (const { x, y, width, height, corrected = false } of placements) {
  const metrics = views.map((view) => ({
    id: view.id,
    coverage: Object.fromEntries(
      Object.entries(view.groups).map(([key, group]) => [
        key,
        group.samples
          .filter(
            ({ hit }) =>
              hit && Math.abs(hit[0] - x) <= width / 2 && Math.abs(hit[1] - y) <= height / 2,
          )
          .reduce((sum, sample) => sum + sample.area, 0) / group.area,
      ]),
    ),
  }))
  candidates.push({
    position: [x, y, 6.86],
    width,
    height,
    corrected,
    metrics,
    rankingOnly:
      metrics.reduce((sum, view) => sum + view.coverage.roof - 2 * view.coverage.glass, 0) /
      metrics.length,
  })
}
candidates.sort((a, b) => b.rankingOnly - a.rankingOnly)
await writeFile(
  `${directory}/rim-candidates.json`,
  JSON.stringify(
    {
      caveat:
        'Unoccluded mirror-direction area estimate, not measured brightness or image quality. Fixed radiance and emitting area; only rear-wall placements considered.',
      candidates,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify(
    { bestInitial: candidates[0], corrected: candidates.find((item) => item.corrected) },
    null,
    2,
  ),
)
