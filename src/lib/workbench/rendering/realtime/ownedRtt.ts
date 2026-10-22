import { ColorManagement, HalfFloatType, Material, NoToneMapping, REVISION, Vector4 } from 'three'
import {
  NodeMaterial,
  QuadMesh,
  RendererUtils,
  RenderTarget,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import { context, rtt } from 'three/tsl'

type OwnedRttNode = ReturnType<typeof rtt>
const isolatedContexts = new WeakMap<OwnedRttNode, ReturnType<typeof context>>()

/** A texture sampled by a scene material must be resized before that scene's
 * bindings are resolved, rather than lazily inside the material's nested draw.
 */
export function resizeOwnedRtt(
  renderer: WebGPURenderer,
  node: OwnedRttNode,
  width: number,
  height: number,
) {
  const target = node.renderTarget
  if (!target) throw new Error('Owned RTT has no render target to prepare')
  if (target.width === width && target.height === height) return
  node.setSize(width, height)
  renderer.initRenderTarget(target)
}

/** A shadow RTT nested in a beauty material must not inherit beauty's MRT.
 * This per-node bridge is opt-in; other RTT owners keep their existing behavior.
 */
export function isolateOwnedRttMrt(node: OwnedRttNode) {
  if (REVISION !== '185') throw new Error('RTT MRT isolation requires reviewed Three r185')
  const original = node.updateBefore,
    isolatedContext = context({})
  if (isolatedContexts.has(node)) throw new Error('RTT MRT isolation already has an owner')
  isolatedContexts.set(node, isolatedContext)
  const isolated: typeof original = function (this: OwnedRttNode, frame) {
    const renderer = frame.renderer
    if (!renderer) throw new Error('RTT MRT isolation requires an active renderer')
    const previous = renderer.getMRT(),
      previousContext = renderer.contextNode
    try {
      renderer.setMRT(null)
      renderer.contextNode = isolatedContext
      return original.call(this, frame)
    } finally {
      renderer.setMRT(previous)
      renderer.contextNode = previousContext
    }
  }
  node.updateBefore = isolated
  return () => {
    if (node.updateBefore === isolated) node.updateBefore = original
    if (isolatedContexts.get(node) === isolatedContext) isolatedContexts.delete(node)
  }
}

/** Compile the actual single-target RTT quad, bootstrapping graph setup if needed.
 * RTTNode.setup only records _rttNode; it does not compile this material. Native
 * compileAsync may submit dependency updates, so callers hold their renderer
 * preparation lease until this Promise settles. No history is committed here.
 */
export async function compileOwnedRtt(renderer: WebGPURenderer, node: OwnedRttNode) {
  if (REVISION !== '185') throw new Error('RTT compilation requires reviewed Three r185')
  const quad: unknown = Reflect.get(node, '_quadMesh')
  if (!(quad instanceof QuadMesh))
    throw new Error('RTT compilation requires the inspected r185 QuadMesh')
  if (!(quad.material instanceof NodeMaterial))
    throw new Error('RTT compilation requires the inspected r185 NodeMaterial')
  const state = RendererUtils.saveRendererState(renderer),
    viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4()),
    originalContext = renderer.contextNode,
    opaque = renderer.opaque,
    transparent = renderer.transparent,
    depth = renderer.depth,
    stencil = renderer.stencil,
    xr = renderer.xr.enabled
  try {
    renderer.setMRT(null)
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = ColorManagement.workingColorSpace
    // RenderObject's r185 cache key includes context identity/version. Use the
    // same stable context as the real RTT draw, not a fresh prewarm-only context.
    renderer.contextNode = isolatedContexts.get(node) ?? originalContext
    renderer.opaque = true
    renderer.transparent = false
    renderer.depth = false
    renderer.stencil = false
    renderer.xr.enabled = false
    // A parent material can skip this branch at build time. In that case the
    // RTT has not visited setup and _rttNode is still null. Sampling it from a
    // temporary compiled quad asks Three to initialize its real dependency
    // graph. Native compileAsync may render dependency RTTs, under this same
    // guarded preparation stage, but this bootstrap quad is never presented.
    if (Reflect.get(node, '_rttNode') === null) {
      const bootstrapMaterial = new NodeMaterial(),
        bootstrapQuad = new QuadMesh(bootstrapMaterial),
        bootstrapTarget = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
      bootstrapMaterial.fragmentNode = node
      bootstrapQuad.name = 'TreesX.RTT.preparationBootstrap'
      try {
        renderer.setRenderTarget(bootstrapTarget)
        await renderer.compileAsync(bootstrapQuad, bootstrapQuad.camera)
      } finally {
        bootstrapMaterial.dispose()
        bootstrapTarget.dispose()
        // QuadMesh's module-singleton geometry remains borrowed.
      }
    }
    const fragment: unknown = Reflect.get(node, '_rttNode')
    if (!fragment || typeof fragment !== 'object' || Reflect.get(fragment, 'isNode') !== true)
      throw new Error('RTT compilation could not initialize the inspected r185 fragment graph')
    // Match RTTNode.updateBefore's exact quad/material identity and fragment.
    quad.material.fragmentNode = fragment as Node
    renderer.setRenderTarget(node.renderTarget)
    await renderer.compileAsync(quad, quad.camera)
  } finally {
    RendererUtils.restoreRendererState(renderer, state)
    renderer.setViewport(viewport)
    renderer.setScissor(scissor)
    renderer.contextNode = originalContext
    renderer.opaque = opaque
    renderer.transparent = transparent
    renderer.depth = depth
    renderer.stencil = stencil
    renderer.xr.enabled = xr
  }
}

/** r185 RTTNode has no dispose(). Own its target and quad material explicitly. */
export function createOwnedRtt(input: Node, revision = REVISION) {
  if (revision !== '185') throw new Error('RTT ownership must be reviewed for this Three revision')
  // Passing an options object replaces RTTNode's { type: HalfFloatType }
  // default. Explicitly retain signed HDR and SSR's 10000 miss sentinel;
  // RGBA8 silently clamps both radiance and ray length before denoising.
  const node = rtt(input, null, null, { type: HalfFloatType, depthBuffer: false })
  const quad: unknown = Reflect.get(node, '_quadMesh')
  const material: unknown =
    quad && typeof quad === 'object' ? Reflect.get(quad, 'material') : undefined
  const target = node.renderTarget
  if (!(material instanceof Material) || !target) {
    target?.dispose()
    throw new Error('The inspected r185 RTT ownership contract changed')
  }
  let disposed = false
  return {
    node,
    dispose() {
      if (disposed) return
      disposed = true
      target.dispose()
      material.dispose()
      // QuadMesh geometry is a Three module singleton; it is never owned here.
      // Input nodes, loader maps and upstream pass textures are also borrowed.
    },
  }
}
