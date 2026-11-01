import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { DataUtils, Vector3 } from 'three'

// Offline geometric diagnostic, not PMREM/BRDF integration or visible-pixel energy.
// Existing r13 footprints use the same car, camera and room bounds as r14/r15.
const directory = 'artifacts/car-showroom/composition-r13'
const captures = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const probes = []
for (const revision of [14, 15]) {
  const root = `public/studio/cold-studio/cycles-r${revision}`
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
  const record = manifest.records.find((item) => item.role === 'specular')
  assert.equal(record.dataType, 'float16')
  const packed = await readFile(`${root}/${record.file}`)
  assert.equal(hash(packed), record.sha256)
  const bytes = gunzipSync(packed)
  assert.equal(hash(bytes), record.rawSha256)
  assert.equal(bytes.length, record.width * record.height * 8)
  const readDirection = (direction) => {
    const d = direction.clone().normalize()
    const u = Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5
    // Runtime asset explicitly stores bottom-up rows with flipY=false.
    const v = Math.asin(Math.max(-1, Math.min(1, d.y))) / Math.PI + 0.5
    const x = Math.floor(u * record.width) % record.width
    const y = Math.min(record.height - 1, Math.floor(v * record.height))
    return [0, 1, 2].map((channel) =>
      DataUtils.fromHalfFloat(bytes.readUInt16LE(((y * record.width + x) * 4 + channel) * 2)),
    )
  }
  const config = manifest.config
  const origin = new Vector3(...config.capture.position)
  // Independently verify orientation against all known emitter radiances.
  for (const light of Object.values(config.lights)) {
    const value = readDirection(new Vector3(...light.position).sub(origin))
    assert.ok(
      value.every((c) => Math.abs(c - light.radiance) < 0.06),
      light.id,
    )
  }
  probes.push({ revision, config, origin, readDirection })
}
assert.deepEqual(probes[0].config.roomBox, probes[1].config.roomBox)
const bounds = [probes[0].config.roomBox.min, probes[0].config.roomBox.max]
const faces = [
  ['left', 'right'],
  ['floor', 'ceiling'],
  ['front', 'rear'],
]
const luma = (rgb) => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
const results = []
for (const shot of captures.shots.filter((s) => s.stateName === 'whole')) {
  const eye = new Vector3(...shot.target.position)
  const footprint = JSON.parse(
    await readFile(`${directory}/${shot.view.id}-footprint.json`, 'utf8'),
  )
  for (const name of ['sidePaint', 'upperPaint']) {
    const group = footprint.groups[name]
    const sums = {}
    for (const sample of group.samples) {
      const p = new Vector3(...sample.center)
      const ray = p
        .clone()
        .sub(eye)
        .normalize()
        .reflect(new Vector3(...sample.normal))
      let distance = Infinity,
        face
      for (let axis = 0; axis < 3; axis++) {
        const d = ray.getComponent(axis)
        if (Math.abs(d) < 1e-10) continue
        const side = d > 0 ? 1 : 0
        const t = (bounds[side][axis] - sample.center[axis]) / d
        if (t > 0 && t < distance) {
          distance = t
          face = faces[axis][side]
        }
      }
      assert.ok(face && Number.isFinite(distance))
      const hit = p.addScaledVector(ray, distance)
      const values = probes.map((probe) => luma(probe.readDirection(hit.clone().sub(probe.origin))))
      const sum = (sums[face] ??= { area: 0, luma14: 0, luma15: 0, meanHit: [0, 0, 0] })
      sum.area += sample.area
      sum.luma14 += values[0] * sample.area
      sum.luma15 += values[1] * sample.area
      hit.toArray().forEach((value, axis) => {
        sum.meanHit[axis] += value * sample.area
      })
    }
    results.push({
      view: shot.view.id,
      group: name,
      faces: Object.fromEntries(
        Object.entries(sums).map(([face, sum]) => [
          face,
          {
            projectedTriangleFraction: sum.area / group.projectedArea,
            rawLinearLuma14: sum.luma14 / sum.area,
            rawLinearLuma15: sum.luma15 / sum.area,
            ratio: sum.luma14 > 0 ? sum.luma15 / sum.luma14 : null,
            meanHit: sum.meanHit.map((value) => value / sum.area),
          },
        ]),
      ),
    })
  }
}
await writeFile(
  `${directory}/probe-radiance.json`,
  JSON.stringify(
    {
      limitations:
        'Ideal mirror direction, nearest unfiltered HDR texel, interpolated triangle normals, projected triangle weights. No visibility/normal map/PMREM/BRDF/SSR/tone mapping; not pixel coverage or final brightness. Direction verified against emitters. Source geometry and assets read only.',
      results,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify(
    results
      .filter((r) => r.group === 'sidePaint')
      .map((r) => ({
        view: r.view,
        floor: r.faces.floor,
        right: r.faces.right,
      })),
    null,
    2,
  ),
)
