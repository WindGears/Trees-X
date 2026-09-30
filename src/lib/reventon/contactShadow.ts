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
  WebGLRenderTarget,
} from 'three'
import type { Group, MeshPhysicalMaterial, WebGLRenderer } from 'three'

/** A live depth projection, never a baked silhouette of closed doors or wheels. */
export function createContactShadow(renderer: WebGLRenderer, scene: Scene, model: Group) {
  const layer = 7
  const casters: { mesh: Mesh; mask: number }[] = []
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (materials.some((m) => m.transparent || (m as MeshPhysicalMaterial).transmission > 0)) return
    casters.push({ mesh: object, mask: object.layers.mask })
    object.layers.enable(layer)
  })
  const target = new WebGLRenderTarget(2048, 2048)
  const temporary = new WebGLRenderTarget(2048, 2048, { depthBuffer: false })
  target.texture.generateMipmaps = temporary.texture.generateMipmaps = false
  const camera = new OrthographicCamera(-6, 6, 6, -6, 0, 2.4)
  camera.position.y = 0.001
  camera.up.set(0, 0, 1)
  camera.lookAt(0, 1, 0)
  camera.layers.set(layer)
  const depth = new MeshDepthMaterial()
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( 0.0, 0.0, 0.0, pow(1.0 - fragCoordZ, 2.0) );',
    )
  }
  // One-texel spacing keeps a continuous penumbra. Widely spaced nine-tap
  // samples reproduced the car silhouette as visible parallel bands.
  const kernel = Array.from({ length: 65 }, (_, i) => Math.exp(-0.5 * ((i - 32) / 13) ** 2))
  const total = kernel.reduce((sum, value) => sum + value, 0)
  const blur = new ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      axis: { value: new Vector2(1 / 2048, 0) },
      kernel: { value: kernel.map((value) => value / total) },
    },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 axis;
      uniform float kernel[65]; varying vec2 vUv;
      void main() { vec4 sum = vec4(0.0);
        for (int i = 0; i < 65; i++) sum += texture2D(tDiffuse, vUv + axis * float(i - 32)) * kernel[i];
        gl_FragColor = sum;
      }`,
    depthTest: false,
    depthWrite: false,
  })
  const blurScene = new Scene()
  const quadGeometry = new PlaneGeometry(2, 2)
  const quad = new Mesh(quadGeometry, blur)
  blurScene.add(quad)
  const blurCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const planeGeometry = new PlaneGeometry(12, 12).rotateX(Math.PI / 2)
  const planeMaterial = new MeshBasicMaterial({
    map: target.texture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })
  const plane = new Mesh(planeGeometry, planeMaterial)
  plane.name = 'Reventon / live contact shadow'
  plane.position.y = 0
  scene.add(plane)
  const clearColor = new Color()
  let dirty = true
  let disposed = false
  const render = () => {
    if (!dirty || disposed) return
    dirty = false
    const oldTarget = renderer.getRenderTarget()
    const oldAlpha = renderer.getClearAlpha()
    renderer.getClearColor(clearColor)
    const oldMaterial = scene.overrideMaterial
    const oldBackground = scene.background
    const oldShadowUpdate = renderer.shadowMap.autoUpdate
    const oldAutoClear = renderer.autoClear
    try {
      renderer.autoClear = true
      renderer.shadowMap.autoUpdate = false
      renderer.setClearColor(0x000000, 0)
      scene.background = null
      scene.overrideMaterial = depth
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      scene.overrideMaterial = oldMaterial
      blur.uniforms.tDiffuse!.value = target.texture
      blur.uniforms.axis!.value.set(1 / 2048, 0)
      renderer.setRenderTarget(temporary)
      renderer.render(blurScene, blurCamera)
      blur.uniforms.tDiffuse!.value = temporary.texture
      blur.uniforms.axis!.value.set(0, 1 / 2048)
      renderer.setRenderTarget(target)
      renderer.render(blurScene, blurCamera)
    } finally {
      scene.overrideMaterial = oldMaterial
      scene.background = oldBackground
      renderer.shadowMap.autoUpdate = oldShadowUpdate
      renderer.autoClear = oldAutoClear
      renderer.setRenderTarget(oldTarget)
      renderer.setClearColor(clearColor, oldAlpha)
    }
  }
  return {
    markDirty: () => {
      dirty = true
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
    },
  }
}
