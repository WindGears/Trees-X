import { Matrix3, type Texture } from 'three'
import type { Node } from 'three/webgpu'
import { texture, uniform, vec3 } from 'three/tsl'
import type { CarQuerySurface } from './querySurface'

/** One borrowed texture binding, preserving sampler/color-space and UV transform.
 * Rebuild on binding/channel/UV-transform changes. Caller owns texture lifetime;
 * this helper never resizes, copies, uploads, or disposes a source texture.
 * Full-scene material routing/texture-array packing is a separate owner. */
export function carHitTextureSample(source: Texture, surface: CarQuerySurface, lod: Node<'float'>) {
  if (source.channel !== 0 && source.channel !== 1)
    throw new Error('Car query supports texture UV channels 0 and 1 only')
  const matrix = source.matrixAutoUpdate
    ? new Matrix3().setUvTransform(
        source.offset.x,
        source.offset.y,
        source.repeat.x,
        source.repeat.y,
        source.rotation,
        source.center.x,
        source.center.y,
      )
    : source.matrix.clone()
  const uv = source.channel === 0 ? surface.uv : surface.uv1
  const transformed = uniform(matrix).mul(vec3(uv, 1)).xy
  return {
    valid: surface.flags.bitAnd(source.channel === 0 ? 2 : 4).notEqual(0),
    color: texture(source, transformed).level(lod),
  }
}
