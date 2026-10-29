/* global window */
/** Offline diagnostic only. Shading-normal mirror footprints are not occlusion,
 * roughness integration, BRDF energy or an image-quality acceptance metric. */
export function paintReflectionFootprint() {
  const scene = window.__demo.scene.scene.value
  const camera = window.__demo.scene.camera.activeCamera.value
  const root = scene.children.find((node) => node.userData.workbenchProduct)
  const eye = camera.getWorldPosition(camera.position.clone())
  const lights = [],
    samples = []
  scene.updateMatrixWorld(true)
  scene.traverse((node) => {
    if (node.isRectAreaLight && node.userData.carShowroomLight) lights.push(node)
  })
  root.traverse((mesh) => {
    if (!mesh.isMesh) return
    const g = mesh.geometry,
      p = g.getAttribute('position'),
      n = g.getAttribute('normal')
    if (!p || !n) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = g.groups.length
      ? g.groups
      : [{ start: 0, count: g.index?.count ?? p.count, materialIndex: 0 }]
    const nm = mesh.matrixWorld.clone().invert().transpose()
    for (const group of groups) {
      const name = materials[group.materialIndex]?.name ?? ''
      if (!/\/ (20159|15103|21865)$/.test(name)) continue
      for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
        const points = [],
          normal = eye.clone().set(0, 0, 0)
        for (let c = 0; c < 3; c++) {
          const index = g.index ? g.index.getX(i + c) : i + c
          points.push(eye.clone().fromBufferAttribute(p, index).applyMatrix4(mesh.matrixWorld))
          normal.add(eye.clone().fromBufferAttribute(n, index))
        }
        normal.transformDirection(nm)
        const center = points[0]
          .clone()
          .add(points[1])
          .add(points[2])
          .multiplyScalar(1 / 3)
        const incident = center.clone().sub(eye).normalize()
        if (incident.dot(normal) >= 0) continue
        const projected = center.clone().project(camera)
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1)
          continue
        const screen = points.map((point) => point.clone().project(camera))
        const area =
          Math.abs(
            (screen[1].x - screen[0].x) * (screen[2].y - screen[0].y) -
              (screen[2].x - screen[0].x) * (screen[1].y - screen[0].y),
          ) / 2
        const ray = incident.reflect(normal)
        const hits = []
        for (const light of lights) {
          const inverse = light.matrixWorld.clone().invert()
          const origin = center.clone().applyMatrix4(inverse)
          const direction = ray.clone().transformDirection(inverse)
          const distance = -origin.z / direction.z
          if (!Number.isFinite(distance) || distance <= 0) continue
          const hit = origin.addScaledVector(direction, distance)
          if (Math.abs(hit.x) <= light.width / 2 && Math.abs(hit.y) <= light.height / 2)
            hits.push(light.userData.carShowroomLight)
        }
        const distance = (3.66 - center.y) / ray.y
        const ceiling = distance > 0 ? center.clone().addScaledVector(ray, distance) : null
        samples.push({
          mesh: mesh.name,
          material: name,
          center: center.toArray(),
          normal: normal.toArray(),
          area,
          hits,
          ceiling: ceiling ? [ceiling.x, ceiling.z] : null,
        })
      }
    }
  })
  const paint = samples.filter((sample) => /\/ 20159$/.test(sample.material))
  const maxY = Math.max(...paint.map((sample) => sample.center[1]))
  const groups = {
    roof: paint.filter((sample) => sample.normal[1] > 0.8 && sample.center[1] > maxY - 0.25),
    upperPaint: paint.filter((sample) => sample.normal[1] > 0.8),
    sidePaint: paint.filter((sample) => Math.abs(sample.normal[0]) > 0.65),
    glass: samples.filter((sample) => !/\/ 20159$/.test(sample.material)),
  }
  const summarize = (entries) => {
    const area = entries.reduce((sum, sample) => sum + sample.area, 0)
    return {
      triangles: entries.length,
      projectedArea: area,
      panelAreaFraction: Object.fromEntries(
        lights.map((light) => [
          light.userData.carShowroomLight,
          area
            ? entries
                .filter((sample) => sample.hits.includes(light.userData.carShowroomLight))
                .reduce((sum, sample) => sum + sample.area, 0) / area
            : 0,
        ]),
      ),
      samples: entries.map(({ center, normal, area, ceiling }) => ({
        center,
        normal,
        area,
        ceiling,
      })),
    }
  }
  return {
    caveat:
      'Front-facing projected triangle area; no occlusion, roughness or BRDF integration. Roof is height/normal diagnostic grouping, not a semantic binding.',
    maxY,
    groups: Object.fromEntries(
      Object.entries(groups).map(([key, entries]) => [key, summarize(entries)]),
    ),
  }
}
