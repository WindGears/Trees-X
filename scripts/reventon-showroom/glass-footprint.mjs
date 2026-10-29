/* global window */
/** Diagnostic only: mirror rays at real glass triangle centres against actual
 * rectangular light planes. No render loop, readback or source geometry edits.
 * This measures geometric coverage, not rough-surface radiance or visibility.
 */
export function glassReflectionFootprint() {
  const scene = window.__demo.scene.scene.value
  const camera = window.__demo.scene.camera.activeCamera.value
  const lights = []
  scene.traverse((node) => {
    if (node.isRectAreaLight && node.userData.carShowroomLight) lights.push(node)
  })
  scene.updateMatrixWorld(true)
  const eye = camera.getWorldPosition(camera.position.clone())
  const canvas = window.__demo.scene.renderer.instance.domElement
  const result = []
  for (const mesh of window.__glassAudit.meshes) {
    const geometry = mesh.geometry
    const positions = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')
    if (!positions || !normals) continue
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }]
    const normalMatrix = mesh.matrixWorld.clone().invert().transpose()
    const counts = Object.fromEntries(lights.map((light) => [light.userData.carShowroomLight, 0]))
    const windshieldCeiling = []
    let triangles = 0,
      minDot = 1,
      maxDot = 0
    for (const group of groups) {
      if (!/\/ (15103|21865)$/.test(materials[group.materialIndex]?.name ?? '')) continue
      for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
        const point = eye.clone().set(0, 0, 0)
        const normal = point.clone()
        for (let corner = 0; corner < 3; corner++) {
          const index = geometry.index ? geometry.index.getX(i + corner) : i + corner
          point.add(eye.clone().fromBufferAttribute(positions, index))
          normal.add(eye.clone().fromBufferAttribute(normals, index))
        }
        point.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld)
        normal.transformDirection(normalMatrix)
        const incident = point.clone().sub(eye).normalize()
        const dot = Math.abs(incident.dot(normal))
        minDot = Math.min(minDot, dot)
        maxDot = Math.max(maxDot, dot)
        const reflected = incident.reflect(normal)
        const projected = point.clone().project(camera)
        const screenX = ((projected.x + 1) * canvas.width) / 2
        const screenY = ((1 - projected.y) * canvas.height) / 2
        // Fixed default-view diagnostic ROI, not a production semantic binding.
        if (
          canvas.width === 1440 &&
          canvas.height === 1000 &&
          screenX >= 750 &&
          screenX <= 1070 &&
          screenY >= 425 &&
          screenY <= 550 &&
          reflected.y > 1e-6
        ) {
          const distance = (3.66 - point.y) / reflected.y
          const hit = point.clone().addScaledVector(reflected, distance)
          if (distance > 0) windshieldCeiling.push({ x: hit.x, z: hit.z })
        }
        triangles++
        for (const light of lights) {
          const inverse = light.matrixWorld.clone().invert()
          const origin = point.clone().applyMatrix4(inverse)
          const direction = reflected.clone().transformDirection(inverse)
          if (Math.abs(direction.z) < 1e-8) continue
          const distance = -origin.z / direction.z
          if (distance <= 0) continue
          const hit = origin.addScaledVector(direction, distance)
          if (Math.abs(hit.x) <= light.width / 2 && Math.abs(hit.y) <= light.height / 2)
            counts[light.userData.carShowroomLight]++
        }
      }
    }
    result.push({
      mesh: mesh.name,
      triangles,
      minViewNormalDot: minDot,
      maxViewNormalDot: maxDot,
      panelHits: counts,
      windshieldCeiling,
    })
  }
  return result
}
