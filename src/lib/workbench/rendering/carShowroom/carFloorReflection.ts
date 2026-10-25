import { Mesh, type Object3D } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  cameraPosition,
  float,
  mix,
  positionWorld,
  reflector,
  screenSize,
  screenUV,
  vec2,
  vec4,
} from 'three/tsl'
import { bindProductReflectionCapture } from '../productReflectionCapture'
import { bindReflectionProjection } from '../reflectionProjection'

/** Dynamic car coverage over the static room floor. No baked car pose or source ownership. */
export function createCarFloorReflection(floor: Mesh, product: Object3D) {
  const geometry = floor.geometry.clone(),
    material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false }),
    reflected = reflector({ resolutionScale: 1, samples: 4, bounces: false }),
    mesh = new Mesh(geometry, material)
  let releaseProjection: (() => void) | undefined, releaseCapture: (() => void) | undefined
  try {
    releaseProjection = bindReflectionProjection(reflected)
    releaseCapture = bindProductReflectionCapture(reflected, product)
  } catch (error) {
    releaseProjection?.()
    reflected.dispose()
    geometry.dispose()
    material.dispose()
    throw error
  }
  let filtered: Node<'vec4'> = vec4(0)
  const weights = [1, 4, 6, 4, 1]
  // Filter premultiplied coverage and radiance together; no white background halo.
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++)
      filtered = filtered.add(
        reflected
          .sample(
            screenUV.flipX().add(
              vec2(x - 2, y - 2)
                .mul(2.2)
                .div(screenSize),
            ),
          )
          .mul((weights[x]! * weights[y]!) / 256),
      )
  const grazing = cameraPosition.sub(positionWorld).normalize().y.abs().oneMinus().pow(5)
  material.colorNode = filtered.rgb.div(filtered.a.max(1e-5))
  // A bounded rough-stone reflection approximation, not an additive emissive decal.
  material.opacityNode = filtered.a.clamp().mul(mix(float(0.12), float(0.48), grazing))
  material.name = 'Trees X / car-only rough floor reflection'
  mesh.name = 'Trees X / cold studio car reflection'
  mesh.position.copy(floor.position)
  mesh.position.y += 0.0004
  mesh.renderOrder = 1
  mesh.userData.traceExclude = true
  mesh.userData.reflectionCapture = 'car-premultiplied-coverage'
  // Reflector planes use local +Z; the cloned floor geometry already lies on XZ.
  reflected.target.rotation.x = -Math.PI / 2
  mesh.add(reflected.target)
  let disposed = false
  return {
    mesh,
    dispose() {
      if (disposed) return
      disposed = true
      mesh.removeFromParent()
      releaseCapture?.()
      releaseProjection?.()
      reflected.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
