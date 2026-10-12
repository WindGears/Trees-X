import { Mesh, Shape, ShapeGeometry } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  cameraPosition,
  float,
  mix,
  normalWorld,
  positionWorld,
  reflector,
  screenSize,
  screenUV,
  vec2,
  vec3,
} from 'three/tsl'
import { studioDesign } from '../studio/design'

/** TSL version of the existing soft planar bounce, owned by the studio rather than its source model. */
export function createGpuStudioReflection(groundY: number = studioDesign.groundY) {
  const width = studioDesign.width - studioDesign.radius * 2,
    depth = studioDesign.depth - studioDesign.radius * 2,
    radius = studioDesign.radius,
    shape = new Shape(),
    x = -width / 2,
    y = -depth / 2
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + depth - radius)
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth)
  shape.lineTo(x + radius, y + depth)
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  const geometry = new ShapeGeometry(shape, 12),
    material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }),
    reflected = reflector({ resolutionScale: 0.75, samples: 4, bounces: false })
  let blurred: Node<'vec3'> = vec3(0)
  const weights = [1, 4, 6, 4, 1]
  const step = vec2(1.5).div(screenSize.mul(0.75))
  for (let row = 0; row < 5; row++)
    for (let column = 0; column < 5; column++) {
      const offset = vec2(column - 2, row - 2).mul(step)
      blurred = blurred.add(
        reflected
          .sample(screenUV.flipX().add(offset))
          .rgb.mul((weights[row]! * weights[column]!) / 256),
      )
    }
  material.colorNode = blurred
  const grazing = cameraPosition
    .sub(positionWorld)
    .normalize()
    .dot(normalWorld.normalize())
    .abs()
    .oneMinus()
    .pow(3)
  material.opacityNode = float(0.28).mul(mix(0.45, 1, grazing))
  material.name = 'TreesXStudioSoftReflectionTSL'
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Trees X / studio reflection'
  mesh.userData.traceExclude = true
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = groundY + 0.00035
  mesh.renderOrder = 1
  mesh.add(reflected.target)
  let disposed = false
  return {
    mesh,
    dispose() {
      if (disposed) return
      disposed = true
      mesh.removeFromParent()
      reflected.dispose()
      material.dispose()
      geometry.dispose()
    },
  }
}
