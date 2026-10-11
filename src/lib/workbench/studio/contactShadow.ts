import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Group,
  type MeshPhysicalMaterial,
  type WebGLRenderer,
} from 'three'
import { studioDesign } from './design'

/** A pose-dependent depth projection; input model resources remain loader-owned. */
export function createStudioContactShadow(
  renderer: WebGLRenderer,
  scene: Scene,
  model: Group,
  groundY: number,
) {
  const resolution = 1024,
    layer = 7
  const casters: { mesh: Mesh; mask: number }[] = []
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
  const target = new WebGLRenderTarget(resolution, resolution)
  const temporary = new WebGLRenderTarget(resolution, resolution, { depthBuffer: false })
  target.texture.generateMipmaps = temporary.texture.generateMipmaps = false
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
  const depth = new MeshDepthMaterial()
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( 0.0, 0.0, 0.0, pow(1.0 - fragCoordZ, 5.0) );',
    )
  }
  const kernel = Array.from({ length: 33 }, (_, index) =>
    Math.exp(-0.5 * ((index - 16) / 6.8) ** 2),
  )
  const total = kernel.reduce((sum, value) => sum + value, 0)
  const blur = new ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      axis: { value: new Vector2(1 / resolution, 0) },
      kernel: { value: kernel.map((value) => value / total) },
    },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 axis; uniform float kernel[33]; varying vec2 vUv;
      void main() { vec4 sum = vec4(0.0); for (int i = 0; i < 33; i++) sum += texture2D(tDiffuse, vUv + axis * float(i - 16)) * kernel[i]; gl_FragColor = sum; }`,
    depthTest: false,
    depthWrite: false,
  })
  const blurScene = new Scene(),
    quadGeometry = new PlaneGeometry(2, 2)
  blurScene.add(new Mesh(quadGeometry, blur))
  const blurCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const planeGeometry = new PlaneGeometry(
    studioDesign.width - 0.13,
    studioDesign.depth - 0.13,
  ).rotateX(Math.PI / 2)
  const planeMaterial = new MeshBasicMaterial({
    map: target.texture,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
  const plane = new Mesh(planeGeometry, planeMaterial)
  plane.name = 'Trees X / studio contact shadow'
  plane.position.y = groundY + 0.0008
  plane.renderOrder = 2
  scene.add(plane)
  const clearColor = new Color(),
    viewport = new Vector4(),
    scissor = new Vector4()
  let dirty = true,
    disposed = false
  const render = () => {
    if (!dirty || disposed) return
    const oldTarget = renderer.getRenderTarget()
    const oldFace = renderer.getActiveCubeFace(),
      oldMip = renderer.getActiveMipmapLevel()
    const oldAlpha = renderer.getClearAlpha()
    renderer.getClearColor(clearColor)
    renderer.getViewport(viewport)
    renderer.getScissor(scissor)
    const oldScissorTest = renderer.getScissorTest()
    const oldMaterial = scene.overrideMaterial,
      oldBackground = scene.background
    const oldShadow = renderer.shadowMap.autoUpdate,
      oldAutoClear = renderer.autoClear
    const oldXr = renderer.xr.enabled
    try {
      renderer.autoClear = true
      renderer.xr.enabled = false
      renderer.shadowMap.autoUpdate = false
      renderer.setScissorTest(false)
      renderer.setClearColor(0x000000, 0)
      scene.background = null
      scene.overrideMaterial = depth
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      scene.overrideMaterial = oldMaterial
      blur.uniforms.tDiffuse!.value = target.texture
      blur.uniforms.axis!.value.set(1 / resolution, 0)
      renderer.setRenderTarget(temporary)
      renderer.render(blurScene, blurCamera)
      blur.uniforms.tDiffuse!.value = temporary.texture
      blur.uniforms.axis!.value.set(0, 1 / resolution)
      renderer.setRenderTarget(target)
      renderer.render(blurScene, blurCamera)
      dirty = false
    } finally {
      scene.overrideMaterial = oldMaterial
      scene.background = oldBackground
      renderer.shadowMap.autoUpdate = oldShadow
      renderer.autoClear = oldAutoClear
      renderer.xr.enabled = oldXr
      renderer.setRenderTarget(oldTarget, oldFace, oldMip)
      renderer.setClearColor(clearColor, oldAlpha)
      renderer.setViewport(viewport)
      renderer.setScissor(scissor)
      renderer.setScissorTest(oldScissorTest)
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
