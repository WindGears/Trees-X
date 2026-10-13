import { HalfFloatType, MaterialBlending, RGFormat, UnsignedByteType } from 'three'
import {
  BlendMode,
  type Node,
  type NodeBuilder,
  type PerspectiveCamera,
  type Scene,
} from 'three/webgpu'
import {
  diffuseColor,
  Fn,
  materialMetalness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  vec4,
} from 'three/tsl'
import { diffuseCaptureNode, physicalRoughnessNode, specularCaptureNode } from './materials'

// In this attachment alpha means material opacity, not roughness or a BRDF
// weight. Opaque surfaces write 1; each native transparent fragment leaves
// (1 - opacity) of the underlying lighting correction. Source maps are borrowed.
const correctionThroughput = Fn((builder: NodeBuilder) =>
  builder.material.transparent ? vec4(0, 0, 0, diffuseColor.a) : vec4(1),
)()

/** Two same-renderer passes trade one extra opaque scene draw for consistent
 * surface depth/normal/lighting inputs. Transparent decals still render with
 * their native alpha in complete HDR beauty, never into lighting geometry MRTs.
 * Each pass owns a distinct depth target; neither clears the other's textures.
 */
export function createRealtimeSceneInputs(scene: Scene, camera: PerspectiveCamera, motion: Node) {
  const surface = pass(scene, camera, { samples: 0 })
  surface.transparent = false
  surface.setMRT(
    mrt({
      output,
      normal: vec4(packNormalToRGB(normalView), physicalRoughnessNode),
      albedo: vec4(diffuseColor.rgb, materialMetalness),
      motion,
      baseSpecular: specularCaptureNode,
      baseDiffuse: diffuseCaptureNode,
    }),
  )
  // Curved normals/micro-roughness remain full precision. The six surface
  // attachments retain the inspected 44-byte aligned cost, within the 64 limit.
  surface.getTexture('normal').type = HalfFloatType
  surface.getTexture('albedo').type = UnsignedByteType
  surface.getTexture('motion').type = HalfFloatType
  surface.getTexture('motion').format = RGFormat

  const beauty = pass(scene, camera, { samples: 0 })
  beauty.setMRT(
    mrt({ output, correctionThroughput }).setBlendMode(
      'correctionThroughput',
      new BlendMode(MaterialBlending),
    ),
  )
  // This separate RGBA8 attachment adds four bytes/pixel. Its RGB tracks
  // transmittance; standard material blending uses its genuine opacity alpha.
  beauty.getTexture('correctionThroughput').type = UnsignedByteType
  let disposed = false
  return {
    surface,
    beauty,
    color: beauty.getTextureNode('output'),
    correctionWeight: beauty.getTextureNode('correctionThroughput').r,
    depth: surface.getTextureNode('depth'),
    normal: surface.getTextureNode('normal'),
    albedo: surface.getTextureNode('albedo'),
    velocity: surface.getTextureNode('motion'),
    baseSpecular: surface.getTextureNode('baseSpecular'),
    baseDiffuse: surface.getTextureNode('baseDiffuse'),
    dispose() {
      if (disposed) return
      disposed = true
      beauty.dispose()
      surface.dispose()
    },
  }
}
