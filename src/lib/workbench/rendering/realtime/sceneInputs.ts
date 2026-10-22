import {
  ColorManagement,
  FloatType,
  HalfFloatType,
  MaterialBlending,
  Mesh,
  NoToneMapping,
  RGFormat,
  UnsignedByteType,
  Vector2,
  type Object3D,
  type Material,
} from 'three'
import {
  BlendMode,
  type Node,
  type NodeBuilder,
  type PerspectiveCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import {
  diffuseColor,
  context,
  Fn,
  materialMetalness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  vec4,
} from 'three/tsl'
import {
  diffuseCaptureNode,
  diffuseResponseNode,
  physicalRoughnessNode,
  specularCaptureNode,
} from './materials'
import { preservePreparationState } from '../preparationState'
import { isCarShadowReceiver, type CarShadowBinding } from './carShadow/light'

function flowContext(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object') return {}
  const read: unknown = Reflect.get(node, 'getFlowContextData')
  if (typeof read !== 'function') throw new Error('Pass preparation requires audited r185 context')
  const value: unknown = read.call(node)
  if (!value || typeof value !== 'object') throw new Error('Invalid pass context data')
  return value as Record<string, unknown>
}

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
export function createRealtimeSceneInputs(
  scene: Scene,
  camera: PerspectiveCamera,
  motion: Node,
  keyShadow = false,
) {
  const surface = pass(scene, camera, { samples: 0 })
  surface.transparent = false
  surface.setMRT(
    mrt({
      // Its RGB remains the original diffuse response. Only the car-shadow
      // experiment repurposes otherwise-unread alpha as a ray receiver mask.
      output: keyShadow
        ? vec4(
            diffuseResponseNode.rgb,
            Fn((builder: NodeBuilder) =>
              isCarShadowReceiver(builder.object, builder.material) ? 1 : 0,
            )(),
          )
        : diffuseResponseNode,
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
  const scenePasses = [surface, beauty] as const
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
    diffuseResponse: surface.getTextureNode('output'),
    resize(width: number, height: number, renderer: WebGPURenderer) {
      // Allocate shared scene attachments before any dependent beauty draw
      // updates its texture bindings. PassNode's lazy resize can otherwise
      // destroy a surface depth texture halfway through that same draw.
      for (const input of scenePasses) {
        const target = input.renderTarget
        if (target.width === width && target.height === height) continue
        input.setSize(width, height)
        // RenderTarget.setSize only resizes color images. Eager native init
        // also resolves depth dimensions/generation before a nested dependency
        // can bind the previous depth allocation inside the beauty encoder.
        renderer.initRenderTarget(target)
      }
    },
    setKeyShadow(binding?: CarShadowBinding) {
      // No surface dependency on its own derived visibility. Only beauty reads it.
      surface.contextNode = binding ? context({ treesCarKeyShadowPass: 'surface' }) : null
      beauty.contextNode = binding
        ? context({ treesCarKeyShadowPass: 'beauty', treesCarKeyShadow: binding })
        : null
      surface.needsUpdate = true
      beauty.needsUpdate = true
      scene.traverse((object) => {
        if (object instanceof Mesh)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.needsUpdate = true
      })
    },
    async prepare(renderer: WebGPURenderer, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Cannot prepare disposed scene inputs')
      const restore = preservePreparationState(renderer, scene, camera),
        initialContext = renderer.contextNode,
        size = renderer.getDrawingBufferSize(new Vector2()),
        culled = new Map<Object3D, boolean>(),
        deferredMaterials = new Map<Material, boolean>()
      try {
        // Compile registered model variants outside the current frustum too.
        // Mesh visibility, layers, assets and the observation camera stay intact.
        scene.traverse((object) => {
          // r185 compileAsync runs viewport updateBefore outside the original
          // render context. Prebinding its framebuffer may lock in Canvas BGRA
          // instead of HDR. Let only these materials compile in the real first
          // draw, where their native copy context exists. Ordinary alpha decals
          // and opaque groups on the same mesh still receive MRT prewarming.
          if (object instanceof Mesh)
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material]) {
              const transmission = Reflect.get(material, 'transmission')
              if (
                (typeof transmission === 'number' && transmission > 0) ||
                Reflect.get(material, 'transmissionNode') ||
                Reflect.get(material, 'backdropNode')
              ) {
                if (!deferredMaterials.has(material))
                  deferredMaterials.set(material, material.visible)
                material.visible = false
              }
            }
          if (object.userData.workbenchProduct)
            object.traverse((child) => {
              if (!culled.has(child)) culled.set(child, child.frustumCulled)
              child.frustumCulled = false
            })
        })
        renderer.toneMapping = NoToneMapping
        renderer.outputColorSpace = ColorManagement.workingColorSpace
        renderer.xr.enabled = false
        renderer.autoClear = true
        // Match PassNode.setup before compiling: output type/sample count must
        // already match the actual linear HDR graph, not the default Canvas.
        for (const input of scenePasses) {
          signal?.throwIfAborted()
          if (disposed) throw new Error('Scene inputs disposed during preparation')
          input.renderTarget.samples = 0
          input.renderTarget.texture.type = renderer.getOutputBufferType()
          if (renderer.reversedDepthBuffer && input.renderTarget.depthTexture)
            input.renderTarget.depthTexture.type = FloatType
          input.setSize(size.x, size.y)
          renderer.opaque = input.opaque
          renderer.transparent = input.transparent
          renderer.depth = input.renderTarget.depthBuffer
          renderer.stencil = input.renderTarget.stencilBuffer
          // r185 PassNode.compileAsync omits the context applied by updateBefore.
          // Never inherit the previous surface context when compiling beauty.
          renderer.contextNode = input.contextNode
            ? context({ ...flowContext(initialContext), ...flowContext(input.contextNode) })
            : initialContext
          await input.compileAsync(renderer)
          signal?.throwIfAborted()
          if (disposed) throw new Error('Scene inputs disposed during preparation')
        }
      } finally {
        for (const [object, value] of culled) object.frustumCulled = value
        for (const [material, visible] of deferredMaterials) material.visible = visible
        restore()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      beauty.dispose()
      surface.dispose()
    },
  }
}
