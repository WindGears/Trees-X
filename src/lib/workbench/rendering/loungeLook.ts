import { gsap } from 'gsap'
import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Vector2,
  type RectAreaLight,
} from 'three'
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu'
import {
  color,
  equirectUV,
  float,
  mix,
  normalMap,
  positionLocal,
  smoothstep,
  texture,
  uniform,
  vec2,
} from 'three/tsl'
import type { createGpuStudioGeometry } from './studioGeometry'
import { loadLoungeAssets, type LoungeAssets } from './loungeAssets'
import { studioPalettes } from '../studio/palette'
import type { StudioEnvironmentStatus, StudioMoodUpdate } from '../studio/mood'

/** Appearance only. No camera/model writes, renderer, extra draw or automatic ticker. */
export function createLoungeLook(
  geometry: ReturnType<typeof createGpuStudioGeometry>,
  lights: RectAreaLight[],
) {
  const { skyMaterial, pedestal, surface, floorMaterial, traceFloor, group } = geometry
  const placeholder = (rgba: number[], srgb = false) => {
    const result = new DataTexture(new Uint8Array(rgba), 1, 1)
    if (srgb) result.colorSpace = SRGBColorSpace
    // r185 chooses textureSample versus unfiltered textureLoad at compile time.
    // The initial placeholder must have the final sampler class before first compile.
    result.minFilter = LinearMipmapLinearFilter
    result.magFilter = LinearFilter
    result.generateMipmaps = true
    result.needsUpdate = true
    return result
  }
  const placeholders = [
    placeholder([42, 31, 23, 255], true),
    placeholder([68, 57, 47, 255], true),
    placeholder([82, 82, 82, 255]),
    placeholder([128, 128, 255, 255]),
  ]
  const amount = uniform(0),
    ready = uniform(0),
    panorama = texture(placeholders[0]!),
    base = texture(placeholders[1]!),
    roughness = texture(placeholders[2]!),
    normal = texture(placeholders[3]!),
    material = new MeshPhysicalNodeMaterial().copy(surface)
  const direction = positionLocal.normalize(),
    coordinate = equirectUV(direction),
    longitude = coordinate.x.add(0.08).fract(),
    latitude = coordinate.y,
    distance = longitude.min(longitude.oneMinus()),
    sample = (u: Node<'float'>) => panorama.sample(vec2(u, latitude)).level(float(3.5)).rgb,
    seamAverage = sample(float(0.025))
      .add(sample(float(0.975)))
      .mul(0.5)
  // A rendering guard, not a claim that the source panorama has been repaired.
  const joined = mix(sample(longitude), seamAverage, smoothstep(0, 0.025, distance).oneMinus()),
    pole = smoothstep(0.84, 0.98, direction.y.abs()),
    backdrop = mix(joined.mul(0.9), color('#241c17'), pole),
    darkSky = mix(color('#241c17'), backdrop, ready),
    lightSky = skyMaterial.colorNode as Node<'vec3'>
  skyMaterial.colorNode = mix(lightSky, darkSky, amount)
  material.name = 'TreesXAmberStonePhysical'
  material.colorNode = mix(
    color(studioPalettes.light.pedestal),
    mix(color(studioPalettes.dark.pedestal), base.rgb, ready),
    amount,
  )
  material.roughnessNode = mix(float(surface.roughness), roughness.g, amount.mul(ready))
  material.normalNode = normalMap(normal.xyz, vec2(0.28).mul(amount).mul(ready))
  material.clearcoat = 0.2
  material.clearcoatRoughness = 0.3
  pedestal.material = material
  const lightFloor = new Color(studioPalettes.light.floor),
    darkFloor = new Color(studioPalettes.dark.floor),
    originalLights = lights.map((light) => ({
      color: light.color.clone(),
      intensity: light.intensity,
    })),
    warmLights = [new Color('#ffe4c0'), new Color('#fff0dc'), new Color('#dfb489')],
    warmPower = [0.6, 0.92, 0.85]
  let assets: LoungeAssets | undefined,
    loading = false,
    disposed = false,
    target: 'light' | 'dark' = 'light',
    started = 0,
    tween: gsap.core.Tween | undefined,
    status: StudioEnvironmentStatus = { phase: 'idle' },
    changed = () => {},
    report: (status: StudioEnvironmentStatus) => void = () => {}
  const abort = new AbortController()
  group.userData.lounge = { status: 'idle', defocusLod: 3.5, seamGuard: true, poleFade: true }
  function publish(value: StudioEnvironmentStatus) {
    status = value
    group.userData.lounge.status = value.phase
    report(value)
  }
  async function load() {
    if (disposed || loading || assets) return
    loading = true
    publish({ phase: 'loading' })
    try {
      const result = await loadLoungeAssets(abort.signal)
      if (disposed) {
        result.dispose()
        return
      }
      assets = result
      panorama.value = result.panorama
      base.value = result.baseColor
      roughness.value = result.roughness
      normal.value = result.normal
      material.map = result.baseColor
      material.normalMap = result.normal
      material.normalScale = new Vector2(0.28, 0.28)
      material.roughnessMap = result.roughness
      ready.value = 1
      skyMaterial.needsUpdate = material.needsUpdate = true
      publish({ phase: 'ready' })
      changed()
    } catch (cause) {
      if (!disposed)
        publish({
          phase: 'error',
          error: cause instanceof Error ? cause.message : '环境素材读取失败',
        })
    } finally {
      loading = false
    }
  }
  function update() {
    const blend = amount.value
    floorMaterial.color.copy(lightFloor).lerp(darkFloor, blend)
    traceFloor.color.copy(floorMaterial.color)
    for (let index = 0; index < lights.length; index++) {
      const light = lights[index]!,
        original = originalLights[index]!
      light.color.copy(original.color).lerp(warmLights[index]!, blend)
      light.intensity = original.intensity * (1 + (warmPower[index]! - 1) * blend)
    }
  }
  return {
    setMood(value: StudioMoodUpdate) {
      if (disposed) return
      changed = value.changed
      report = value.report
      target = value.mood
      group.userData.studioMood = target
      report(status)
      if (target === 'dark') void load()
      tween?.kill()
      tween = undefined
      const destination = target === 'dark' ? 1 : 0
      const reduced =
        typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced || amount.value === destination) {
        amount.value = destination
        update()
      } else {
        started = performance.now()
        // Advance only from the existing studio.beforeRaster clock.
        tween = gsap.to(amount, {
          value: destination,
          duration: 0.42,
          ease: 'power2.inOut',
          paused: true,
          onUpdate: update,
        })
      }
      changed()
    },
    render() {
      if (disposed || !tween) return
      tween.totalTime(Math.min(0.42, (performance.now() - started) / 1000))
      changed()
      if (tween.progress() === 1) {
        tween.kill()
        tween = undefined
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      abort.abort()
      tween?.kill()
      tween = undefined
      if (pedestal.material === material) pedestal.material = surface
      material.dispose()
      assets?.dispose()
      assets = undefined
      for (const image of placeholders) image.dispose()
    },
  }
}
