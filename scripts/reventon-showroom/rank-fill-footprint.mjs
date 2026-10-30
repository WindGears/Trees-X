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
  views.push({
    id: shot.view.id,
    groups: Object.fromEntries(
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
            const distance = (5.86 - point.x) / ray.x
            return {
              area: sample.area,
              hit: distance > 0 ? point.addScaledVector(ray, distance).toArray() : null,
            }
          }),
        },
      ]),
    ),
  })
}
const coverage = (position, width, height) =>
  views.map((view) => ({
    id: view.id,
    coverage: Object.fromEntries(
      Object.entries(view.groups).map(([key, group]) => [
        key,
        group.samples
          .filter(
            ({ hit }) =>
              hit &&
              Math.abs(hit[2] - position[2]) <= width / 2 &&
              Math.abs(hit[1] - position[1]) <= height / 2,
          )
          .reduce((sum, sample) => sum + sample.area, 0) / group.area,
      ]),
    ),
  }))
const original = { position: [5.86, 2, -2.5], width: 1.2, height: 2.8 }
original.metrics = coverage(original.position, original.width, original.height)
const candidates = []
// Preserve the existing 3.36 square-unit emitter area and clear the floor cove.
for (let z = -4.5; z <= 4.5; z += 0.5) {
  for (let y = 1; y <= 3.25; y += 0.25) {
    const position = [5.86, y, z],
      width = 3.36,
      height = 1
    const metrics = coverage(position, width, height)
    candidates.push({
      position,
      width,
      height,
      metrics,
      rankingOnly:
        metrics.reduce((sum, view) => sum + view.coverage.sidePaint - 2 * view.coverage.glass, 0) /
        metrics.length,
    })
  }
}
candidates.sort((a, b) => b.rankingOnly - a.rankingOnly)
await writeFile(
  `${directory}/fill-candidates.json`,
  JSON.stringify(
    {
      caveat:
        'Unoccluded shading-normal mirror footprints, not brightness, pixel coverage or quality. Camera, source geometry and normals are unchanged between r13 and r14; fill remains in its r13 placement.',
      original,
      candidates,
    },
    null,
    2,
  ),
)
console.log(JSON.stringify({ original, best: candidates.slice(0, 3) }, null, 2))
