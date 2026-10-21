import {
  DoubleSide,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Group,
  type MeshPhysicalMaterial,
} from 'three'
import {
  MeshBasicNodeMaterial,
  NodeMaterial,
  RenderTarget,
  RendererUtils,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import { positionWorld, screenUV, texture, uniform, uv, vec4 } from 'three/tsl'
import { preservePreparationState } from './preparationState'
import { gaussianTaps } from './gaussianPairs'

/** The car's existing 12 m / 2048² / 65-tap projection, with no studio retuning. */
export function createGpuReventonShadow(renderer: WebGPURenderer, scene: Scene, model: Group) {
  const resolution = 2048,
    layer = 7,
    casters: { mesh: Mesh; mask: number }[] = []
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (
      materials.some(
        (material) => material.transparent || (material as MeshPhysicalMaterial).transmission > 0,
      )
    )
      return
    casters.push({ mesh: object, mask: object.layers.mask })
    object.layers.enable(layer)
  })
  const target = new RenderTarget(resolution, resolution, { type: UnsignedByteType }),
    temporary = new RenderTarget(resolution, resolution, {
      type: UnsignedByteType,
      depthBuffer: false,
    }),
    depth = new NodeMaterial(),
    blur = new NodeMaterial()
  for (const value of [target.texture, temporary.texture]) {
    value.generateMipmaps = false
    value.colorSpace = NoColorSpace
  }
  Object.assign(depth, { fog: false, toneMapped: false })
  Object.assign(blur, { fog: false, toneMapped: false, depthTest: false, depthWrite: false })
  depth.name = 'Reventon / contact depth TSL'
  // Original ortho camera: y=0.001, looking +Y, near=0, far=2.4.
  // Its WebGL fragCoordZ is (worldY - 0.001) / 2.4 inside the clipped volume.
  depth.fragmentNode = vec4(0, 0, 0, positionWorld.y.sub(0.001).div(2.4).oneMinus().pow(2))
  const paired =
      typeof location === 'undefined' ||
      new URLSearchParams(location.search).get('carShadowKernel') !== 'legacy',
    kernel = gaussianTaps(32, 13, paired),
    source = texture(target.texture),
    axis = uniform(new Vector2(1 / resolution, 0))
  let sum: Node<'vec4'> = vec4(0)
  for (const tap of kernel)
    sum = sum.add(source.sample(screenUV.add(axis.mul(tap.offset))).mul(tap.weight))
  blur.fragmentNode = sum
  blur.name = 'Reventon / contact Gaussian TSL'
  const blurScene = new Scene(),
    quadGeometry = new PlaneGeometry(2, 2),
    blurCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1),
    camera = new OrthographicCamera(-6, 6, 6, -6, 0, 2.4)
  blurScene.add(new Mesh(quadGeometry, blur))
  camera.position.y = 0.001
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 1, 0)
  camera.layers.set(layer)
  const planeGeometry = new PlaneGeometry(12, 12).rotateX(Math.PI / 2),
    planeMaterial = new MeshBasicNodeMaterial({
      map: target.texture,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    plane = new Mesh(planeGeometry, planeMaterial)
  // WebGPU render textures use a top-left origin; mesh UVs are bottom-left.
  // Blur passes stay in screenUV, and only the receiver converts mesh UVs.
  // Leaving the receiver on material.map mirrors the projection along world Z.
  planeMaterial.colorNode = texture(target.texture, uv().flipY())
  plane.name = 'Reventon / live contact shadow'
  plane.userData.shadowKernel = {
    mode: paired ? 'paired' : 'legacy',
    reads: kernel.length,
    radius: 32,
    sigma: 13,
    resolution,
  }
  plane.userData.pipelinesPrepared = false
  plane.userData.traceExclude = true
  plane.position.y = 0
  scene.add(plane)
  const viewport = new Vector4(),
    scissor = new Vector4()
  let dirty = true,
    disposed = false
  return {
    async prepare(signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Cannot prepare disposed car shadow')
      const restore = preservePreparationState(renderer, scene, camera),
        previousSource = source.value,
        axisX = axis.value.x,
        axisY = axis.value.y,
        culled = casters.map(({ mesh }) => mesh.frustumCulled)
      try {
        renderer.autoClear = true
        renderer.xr.enabled = false
        renderer.shadowMap.enabled = false
        renderer.opaque = true
        renderer.transparent = false
        renderer.setMRT(null)
        renderer.setRenderObjectFunction(null)
        renderer.setScissorTest(false)
        renderer.setClearColor(0x000000, 0)
        scene.background = null
        scene.backgroundNode = null
        scene.overrideMaterial = depth
        casters.forEach(({ mesh }) => {
          mesh.frustumCulled = false
        })
        renderer.depth = target.depthBuffer
        renderer.stencil = target.stencilBuffer
        renderer.setRenderTarget(target)
        await renderer.compileAsync(scene, camera)
        signal?.throwIfAborted()
        if (disposed) throw new Error('Car shadow disposed during preparation')
        scene.overrideMaterial = null
        source.value = target.texture
        axis.value.set(1 / resolution, 0)
        renderer.depth = temporary.depthBuffer
        renderer.stencil = temporary.stencilBuffer
        renderer.setRenderTarget(temporary)
        await renderer.compileAsync(blurScene, blurCamera)
        signal?.throwIfAborted()
        if (disposed) throw new Error('Car shadow disposed during preparation')
        // Shader/uniforms are shared, but the vertical destination has a depth
        // attachment. r185 compileAsync reads renderer.depth/stencil instead
        // of the target flags, so explicitly prepare both real PSO variants.
        source.value = temporary.texture
        axis.value.set(0, 1 / resolution)
        renderer.depth = target.depthBuffer
        renderer.stencil = target.stencilBuffer
        renderer.setRenderTarget(target)
        await renderer.compileAsync(blurScene, blurCamera)
        signal?.throwIfAborted()
        if (disposed) throw new Error('Car shadow disposed during preparation')
        plane.userData.pipelinesPrepared = true
      } finally {
        casters.forEach(({ mesh }, index) => {
          mesh.frustumCulled = culled[index]!
        })
        source.value = previousSource
        axis.value.set(axisX, axisY)
        restore()
      }
      // Compiling does not populate the projection. Only all three successful
      // real draws below are allowed to clear dirty.
    },
    markDirty() {
      if (!disposed) dirty = true
    },
    render() {
      if (!dirty || disposed) return
      const state = RendererUtils.saveRendererState(renderer),
        oldMaterial = scene.overrideMaterial,
        oldBackground = scene.background,
        oldBackgroundNode = scene.backgroundNode,
        oldXr = renderer.xr.enabled,
        oldShadows = renderer.shadowMap.enabled
      renderer.getViewport(viewport)
      renderer.getScissor(scissor)
      try {
        renderer.autoClear = true
        renderer.xr.enabled = false
        renderer.shadowMap.enabled = false
        renderer.setMRT(null)
        renderer.setRenderObjectFunction(null)
        renderer.setScissorTest(false)
        renderer.setClearColor(0x000000, 0)
        scene.background = null
        scene.backgroundNode = null
        scene.overrideMaterial = depth
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        scene.overrideMaterial = oldMaterial
        source.value = target.texture
        axis.value.set(1 / resolution, 0)
        renderer.setRenderTarget(temporary)
        renderer.render(blurScene, blurCamera)
        source.value = temporary.texture
        axis.value.set(0, 1 / resolution)
        renderer.setRenderTarget(target)
        renderer.render(blurScene, blurCamera)
        dirty = false
      } finally {
        scene.overrideMaterial = oldMaterial
        scene.background = oldBackground
        scene.backgroundNode = oldBackgroundNode
        renderer.xr.enabled = oldXr
        renderer.shadowMap.enabled = oldShadows
        RendererUtils.restoreRendererState(renderer, state)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      plane.removeFromParent()
      for (const { mesh, mask } of casters) mesh.layers.mask = mask
      for (const resource of [
        target,
        temporary,
        depth,
        blur,
        quadGeometry,
        planeGeometry,
        planeMaterial,
      ])
        resource.dispose()
      blurScene.clear()
    },
  }
}
