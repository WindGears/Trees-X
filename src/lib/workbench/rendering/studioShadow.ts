import {
  DoubleSide,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
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
import { positionWorld, texture, uniform, uv, vec4 } from 'three/tsl'
import { studioDesign } from '../studio/design'

/** Same dirty height projection and two-pass Gaussian as WebGL, expressed entirely in TSL. */
export function createGpuStudioShadow(
  renderer: WebGPURenderer,
  scene: Scene,
  model: Group,
  groundY: number,
) {
  const resolution = 1024,
    layer = 7,
    casters: { mesh: Mesh; mask: number }[] = []
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    if (
      materials.some(
        (material) => material.transparent || (material as MeshPhysicalMaterial).transmission > 0,
      )
    )
      return
    casters.push({ mesh: node, mask: node.layers.mask })
    node.layers.enable(layer)
  })
  const target = new RenderTarget(resolution, resolution, { type: HalfFloatType }),
    temporary = new RenderTarget(resolution, resolution, {
      type: HalfFloatType,
      depthBuffer: false,
    }),
    depth = new NodeMaterial(),
    blur = new NodeMaterial()
  Object.assign(depth, { fog: false, toneMapped: false })
  Object.assign(blur, { depthTest: false, depthWrite: false, toneMapped: false, fog: false })
  target.texture.generateMipmaps = temporary.texture.generateMipmaps = false
  depth.name = 'TreesXStudioShadowDepthTSL'
  depth.fragmentNode = vec4(
    0,
    0,
    0,
    positionWorld.y
      .sub(groundY + 0.0005)
      .div(3.2)
      .oneMinus()
      .clamp(0, 1)
      .pow(8),
  )
  const source = texture(target.texture),
    axis = uniform(new Vector2(1 / resolution, 0)),
    kernel = Array.from({ length: 33 }, (_, index) => Math.exp(-0.5 * ((index - 16) / 4.2) ** 2)),
    total = kernel.reduce((sum, value) => sum + value, 0)
  let sum: Node<'vec4'> = vec4(0)
  for (let i = 0; i < 33; i++)
    sum = sum.add(source.sample(uv().add(axis.mul(i - 16))).mul(kernel[i]! / total))
  blur.fragmentNode = sum
  blur.name = 'TreesXStudioShadowBlurTSL'
  const blurScene = new Scene(),
    quadGeometry = new PlaneGeometry(2, 2),
    blurCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  blurScene.add(new Mesh(quadGeometry, blur))
  const camera = new OrthographicCamera(
    -studioDesign.width / 2,
    studioDesign.width / 2,
    studioDesign.depth / 2,
    -studioDesign.depth / 2,
    0.001,
    3.2,
  )
  camera.position.y = groundY + 0.0005
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 1, 0)
  camera.layers.set(layer)
  const planeGeometry = new PlaneGeometry(studioDesign.width, studioDesign.depth).rotateX(
      Math.PI / 2,
    ),
    planeMaterial = new MeshBasicNodeMaterial({
      map: target.texture,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    plane = new Mesh(planeGeometry, planeMaterial)
  plane.name = 'Trees X / studio contact shadow'
  plane.userData.traceExclude = true
  plane.position.y = groundY + 0.0008
  plane.renderOrder = 2
  scene.add(plane)
  const viewport = new Vector4(),
    scissor = new Vector4()
  let dirty = true,
    disposed = false
  const render = () => {
    if (!dirty || disposed) return
    const state = RendererUtils.saveRendererState(renderer),
      oldMaterial = scene.overrideMaterial,
      oldBackground = scene.background,
      oldBackgroundNode = scene.backgroundNode,
      xr = renderer.xr.enabled
    renderer.getViewport(viewport)
    renderer.getScissor(scissor)
    try {
      renderer.autoClear = true
      renderer.xr.enabled = false
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
      renderer.xr.enabled = xr
      RendererUtils.restoreRendererState(renderer, state)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
    }
  }
  return {
    markDirty() {
      if (!disposed) dirty = true
    },
    render,
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
