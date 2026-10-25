/* global window */
/** Test-only inspection of the actual reflector target/camera. No production pixel polling. */
export async function inspectCarReflection() {
  const host = window.__demo.scene,
    scene = host.scene.value,
    renderer = host.renderer.instance,
    camera = host.camera.activeCamera.value,
    mesh = scene.getObjectByName('Trees X / cold studio car reflection')
  if (!mesh) throw new Error('Missing dynamic car reflection')
  const bases = new Set()
  mesh.material.colorNode.traverse((node) => {
    if (node.reflector?.renderTargets instanceof Map) bases.add(node.reflector)
  })
  if (bases.size !== 1) throw new Error('Expected exactly one owned planar capture')
  const base = [...bases][0],
    virtual = base.virtualCameras.get(camera),
    target = base.renderTargets.get(virtual)
  if (!target || !virtual || !base.hasOutput) throw new Error('No actual reflection output')
  const pixels = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    target.width,
    target.height,
  )
  const half = (v) => {
    const sign = v & 0x8000 ? -1 : 1,
      exp = (v >> 10) & 31,
      fraction = v & 1023
    return exp === 31
      ? NaN
      : sign * (exp ? (1 + fraction / 1024) * 2 ** (exp - 15) : fraction * 2 ** -24)
  }
  let coverage = 0,
    transparent = 0,
    invalid = 0,
    energy = 0,
    spatialMoment = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = half(pixels[i + 3])
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) invalid++
    if (alpha > 0.01) coverage++
    else transparent++
    for (let c = 0; c < 3; c++) {
      const v = half(pixels[i + c])
      if (!Number.isFinite(v) || v < 0) invalid++
      energy += v
      spatialMoment += v * ((i / 4) % target.width)
    }
  }
  let projectionError = 0,
    checked = 0
  const root = scene.children.find((node) => node.userData.workbenchProduct === 'reventon'),
    groundY = mesh.getWorldPosition(camera.position.clone()).y
  root.traverse((node) => {
    if (!node.isMesh || checked >= 100) return
    const world = node.getWorldPosition(camera.position.clone()),
      mirror = world.clone()
    mirror.y = 2 * groundY - mirror.y
    const expected = mirror.project(camera),
      actual = world.project(virtual)
    if (![expected.x, expected.y, actual.x, actual.y].every(Number.isFinite)) return
    projectionError = Math.max(
      projectionError,
      Math.abs(expected.x + actual.x),
      Math.abs(expected.y - actual.y),
    )
    checked++
  })
  return {
    width: target.width,
    height: target.height,
    samples: target.samples,
    textureType: target.texture.type,
    captures: base.renderTargets.size,
    coverage,
    transparent,
    invalid,
    energy,
    spatialMoment,
    checked,
    projectionError,
    principalPoint: camera.projectionMatrix.elements[8],
    mirrorPrincipalPoint: virtual.projectionMatrix.elements[8],
  }
}
