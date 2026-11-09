/** Isolated real GPU contract test; never imported by production. */
import {
  BoxGeometry,
  PlaneGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Group,
  Scene,
  PerspectiveCamera,
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  NearestFilter,
  DoubleSide,
  DataUtils,
  NoToneMapping,
} from 'three'
import { WebGPURenderer, RenderPipeline } from 'three/webgpu'
import { Fn, If, float, mrt, normalView, output, pass, sample, vec4 } from 'three/tsl'
import SSRNode from 'three/addons/tsl/display/SSRNode.js'
import SSRWorldNode from '../workbench/rendering/realtime/carReflection/vendor/SSRWorldNode.js'
import { createCarShadowBvh } from '../workbench/rendering/realtime/carShadow/bvh'
import { carHitTextureSample } from '../workbench/rendering/realtime/carShadow/queryTexture'

export async function runCarReflectionFixture() {
  const renderer = new WebGPURenderer()
  await renderer.init()
  renderer.setSize(128, 128)
  renderer.toneMapping = NoToneMapping
  const plane = new PlaneGeometry(16, 16),
    box = new BoxGeometry(1.5, 1.5, 1.5)
  const mirrorMaterial = new MeshPhysicalMaterial({
    metalness: 1,
    roughness: 0.05,
    side: DoubleSide,
  })
  const boxMaterial = new MeshBasicMaterial({ color: 0x2244aa })
  const traceMaterial = new MeshBasicMaterial({ side: DoubleSide })
  const mirror = new Mesh(plane, mirrorMaterial),
    visibleBox = new Mesh(box, boxMaterial)
  const scene = new Scene().add(mirror, visibleBox)
  // Avoid upstream r185's normalize(cross(Z, N)) singularity at exactly N=Z.
  mirror.rotation.y = 0.1
  visibleBox.visible = false
  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const panel = new Mesh(plane, traceMaterial)
  panel.position.z = 7 // Behind camera, absent from raster inputs: cannot be an SSR hit.
  const queryRoot = new Group().add(panel)
  const abort = new AbortController()
  const owner = await createCarShadowBvh(queryRoot, abort.signal, { surfaceData: true })
  const map = new DataTexture(
    new Uint8Array([255, 32, 16, 255, 16, 255, 32, 255, 32, 16, 255, 255, 255, 255, 32, 255]),
    2,
    2,
    RGBAFormat,
  )
  map.colorSpace = SRGBColorSpace
  map.minFilter = map.magFilter = NearestFilter
  map.needsUpdate = true
  const surface = pass(scene, camera, { samples: 0 })
  surface.setMRT(mrt({ output, normal: vec4(normalView, 1), albedo: vec4(1) }))
  const options = {
    stochastic: true,
    camera,
    diffuseNode: surface.getTextureNode('albedo'),
    metalnessNode: float(1),
    roughnessNode: float(0.05),
    binaryRefine: true,
  }
  const inputs = [
    surface.getTextureNode('output'),
    surface.getTextureNode('depth'),
    sample((uv) => surface.getTextureNode('normal').sample(uv).rgb),
  ] as const
  const native = new SSRNode(...inputs, options)
  const disabled = new SSRWorldNode(...inputs, options)
  const declined = new SSRWorldNode(...inputs, options)
  const world = new SSRWorldNode(...inputs, options)
  const diagnostic = new SSRWorldNode(...inputs, options)
  diagnostic.worldFallback = (ray) => vec4(ray.direction.mul(0.5).add(0.5), 1)
  declined.worldFallback = () => vec4(0)
  world.worldFallback = (ray) =>
    Fn(() => {
      const result = vec4(0).toVar()
      const hit = owner.nearestHit(ray.origin.add(ray.normal.mul(0.001)), ray.direction, float(50))
      If(hit.didHit, () => {
        const sampled = carHitTextureSample(map, owner.surface(hit), float(0))
        If(sampled.valid, () => result.assign(vec4(sampled.color.rgb, hit.distance)))
      })
      return result
    })()
  const effects = [native, disabled, declined, world, diagnostic]
  for (const effect of effects) {
    effect.setEnvMap(map)
    effect.screenEdgeFadeBlack = true
    effect.maxDistance.value = 20
    effect.quality.value = 1
    effect.environmentIntensity.value = 0
    effect.maxLuminance.value = Infinity
    effect.screenEdgeFade.value = 0
  }
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputNode = native
    .getTextureNode()
    .add(disabled.getTextureNode())
    .add(declined.getTextureNode())
    .add(world.getTextureNode())
    .add(diagnostic.getTextureNode())
  const rounds = []
  try {
    for (const state of [
      'offscreen-panel',
      'axis-aligned',
      'panel-moved',
      'screen-hit-priority',
    ] as const) {
      if (state === 'axis-aligned') mirror.rotation.y = 0
      if (state === 'panel-moved') panel.position.x = 100
      if (state === 'screen-hit-priority') {
        panel.position.set(0, 4, 0)
        panel.rotation.x = Math.PI / 2
        mirror.rotation.x = -Math.PI / 2
        mirror.rotation.y = 0
        visibleBox.position.set(0, 0.8, 0)
        visibleBox.visible = true
        camera.position.set(0, 3, 6)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
      }
      queryRoot.updateMatrixWorld(true)
      owner.sync()
      await pipeline.renderAsync()
      const buffers = []
      for (const effect of effects) {
        const pixels = await renderer.readRenderTargetPixelsAsync(
          effect.getRenderTarget(),
          0,
          0,
          128,
          128,
        )
        buffers.push(
          Array.from(pixels, (v) =>
            pixels instanceof Uint16Array ? DataUtils.fromHalfFloat(v) : v,
          ),
        )
      }
      const [base, off, miss, candidate] = buffers as [number[], number[], number[], number[]]
      let maxDisabledError = 0,
        maxDeclinedError = 0,
        maxHitError = 0,
        ssrHits = 0,
        worldHits = 0
      const colors = new Set<string>()
      for (let i = 0; i < base.length; i += 4) {
        const valid = base[i + 3]! > 0 && base[i + 3]! < 9999
        if (valid) ssrHits++
        const worldHit = !valid && candidate[i + 3]! > 0 && candidate[i + 3]! < 9999
        if (worldHit) {
          worldHits++
          colors.add(
            candidate
              .slice(i, i + 3)
              .map((v) => Math.round(v * 10))
              .join(','),
          )
        }
        for (let c = 0; c < 4; c++) {
          maxDisabledError = Math.max(maxDisabledError, Math.abs(base[i + c]! - off[i + c]!))
          maxDeclinedError = Math.max(maxDeclinedError, Math.abs(base[i + c]! - miss[i + c]!))
          if (valid) maxHitError = Math.max(maxHitError, Math.abs(base[i + c]! - candidate[i + c]!))
        }
      }
      rounds.push({
        center: buffers.map((b) => b.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)),
        state,
        maxDisabledError,
        maxDeclinedError,
        maxHitError,
        ssrHits,
        worldHits,
        colors: [...colors],
        resources: owner.snapshot(),
      })
    }
    return { backend: renderer.backend.constructor.name, rounds }
  } finally {
    pipeline.dispose()
    effects.forEach((effect) => effect.dispose())
    surface.dispose()
    abort.abort()
    owner.dispose()
    map.dispose()
    plane.dispose()
    box.dispose()
    mirrorMaterial.dispose()
    boxMaterial.dispose()
    traceMaterial.dispose()
    renderer.dispose()
  }
}
