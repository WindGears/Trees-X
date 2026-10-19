import { Vector2, type Texture } from 'three'
import {
  RenderPipeline,
  RendererUtils,
  type Node,
  type PerspectiveCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu'
import { renderOutput, sample, unpackRGBToNormal, vec4 } from 'three/tsl'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { createOwnedRtt } from './ownedRtt'
import { createReflectionResolve } from './reflectionResolve'
import { createRealtimeSceneInputs } from './sceneInputs'
import type { RealtimeProductProfile } from './productProfile'
import { createLoungeDofFocus, createOwnedLoungeDof, resolveLoungeDof } from '../loungeSpatialDof'

export interface RealtimeIrradiance {
  irradiance: Node<'vec3'>
  validity: Node<'float'>
}

/** Opaque lighting geometry and complete beauty share one renderer and clock.
 * All inputs and composition are full-resolution linear HDR.
 */
export function createRealtimeSignals(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  motion: Node,
  profile?: RealtimeProductProfile,
) {
  const inputs = createRealtimeSceneInputs(scene, camera, motion)
  let loungeFocus = createLoungeDofFocus(
    scene,
    camera,
    resolveLoungeDof() && (profile?.allowLoungeDof ?? true),
  )
  // Explicit engineering comparison only; the realtime entry uses rotation.
  const reflectionKernel =
    new URLSearchParams(location.search).get('reflectionKernel') === 'static'
      ? 'static'
      : 'rotating'
  const {
    color: beauty,
    depth,
    normal,
    albedo,
    velocity,
    baseSpecular,
    baseDiffuse,
    diffuseResponse,
  } = inputs
  const signedNormal = sample((uv) => unpackRGBToNormal(normal.sample(uv).rgb))
  const reflection = ssr(beauty, depth, signedNormal, {
    stochastic: true,
    diffuseNode: albedo,
    metalnessNode: albedo.a,
    roughnessNode: normal.a,
    binaryRefine: true,
    camera,
  })
  reflection.resolutionScale = 1
  reflection.quality.value = 1
  reflection.maxDistance.value = 8
  reflection.thickness.value = 0.035
  reflection.maxLuminance.value = Infinity
  reflection.intensity.value = 1
  // A screen-space miss must retain the stable native PMREM, not replace it
  // with one stochastic HDR sample. r185 still requires the loaded HDR node.
  reflection.environmentIntensity.value = 0
  reflection.screenEdgeFadeBlack = true
  // Resolve owns hit/miss blending. Native edge fade changes only RGB, so
  // leave it disabled to keep raywise replacement and native IBL consistent.
  reflection.screenEdgeFade.value = 0
  const gi = ssgi(beauty, depth, signedNormal, camera)
  gi.useTemporalFiltering = false
  gi.sliceCount.value = 4
  gi.stepCount.value = 12
  gi.radius.value = 1.3
  gi.thickness.value = 0.12
  gi.aoIntensity.value = 1
  gi.giIntensity.value = 1
  // Pass expressions explicitly as texture nodes: effect helpers otherwise
  // allocate implicit RTTs with no recursive dispose path in r185.
  const giInput = createOwnedRtt(vec4(gi.getGINode().rgb, gi.getAONode().r))
  const rawGi = giInput.node
  const spatialGi = recurrentDenoise(rawGi, camera, {
    depth,
    normal,
    raw: rawGi,
    mode: 'diffuse',
    accumulate: false,
  })
  spatialGi.alphaSource = 'ao'
  spatialGi.radius.value = 1
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false
  let antialias: ReturnType<typeof smaa> | undefined,
    composite: ReturnType<typeof createOwnedRtt> | undefined,
    linearBeauty: ReturnType<typeof createOwnedRtt> | undefined,
    loungeDof: ReturnType<typeof createOwnedLoungeDof> | undefined,
    ssrEnabled = true,
    ssgiEnabled = true,
    denoiseEnabled = true,
    disposed = false,
    environment: Texture | null | undefined,
    environmentVersion = -1,
    worldGi: RealtimeIrradiance | null = null
  const savedState = RendererUtils.saveRendererState(renderer)
  const frameSize = new Vector2()
  const reflectionResolve = createReflectionResolve(
    renderer,
    reflection.getTextureNode(),
    baseSpecular,
    depth,
    normal,
    velocity,
    camera,
    reflectionKernel,
  )

  function compose() {
    if (!reflectionResolve) return
    const reflected = denoiseEnabled ? reflectionResolve.filtered : reflectionResolve.raw
    // Filtered payload is signed correction. Native IBL remains in beauty;
    // a miss adds exact zero, and a true black hit can subtract its native lobe.
    const specular = ssrEnabled
      ? baseSpecular.a.greaterThan(0).select(reflected, vec4(0).rgb)
      : vec4(0).rgb
    // SSGI AO affects indirect diffuse only. Local bounce and retained environment
    // are distinct signals; direct light and native coat/anisotropy remain intact.
    const screenDiffuse = ssgiEnabled
      ? baseDiffuse.a
          .greaterThan(0)
          .select(
            baseDiffuse.rgb
              .mul(spatialGi.a.sub(1))
              .add(spatialGi.rgb.mul(albedo.rgb).mul(albedo.a.oneMinus()).mul(baseDiffuse.a)),
            vec4(0).rgb,
          )
      : vec4(0).rgb
    // The world-space field owns diffuse irradiance, including distant sky.
    // Replace captured native indirect diffuse; never add a second full IBL or
    // combine SSGI with DDGI on the same pixel. A fractional receiver weight
    // fades only the signed replacement, retaining native IBL outside the volume.
    const diffuse =
      worldGi && ssgiEnabled
        ? baseDiffuse.a
            .greaterThan(0)
            .select(
              worldGi.irradiance
                .mul(diffuseResponse.rgb)
                .sub(baseDiffuse.rgb)
                .mul(worldGi.validity.clamp(0, 1)),
              vec4(0).rgb,
            )
        : screenDiffuse
    antialias?.dispose()
    composite?.dispose()
    loungeDof?.dispose()
    linearBeauty?.dispose()
    loungeDof = undefined
    linearBeauty = undefined
    // Native transparent beauty is already alpha-composited. Only the opaque
    // surface lighting correction passes through its retained transmittance.
    const correctedBeauty = vec4(
      beauty.rgb.add(specular.add(diffuse).mul(inputs.correctionWeight)).max(0),
      1,
    )
    if (loungeFocus.enabled) {
      // DOF samples corrected linear HDR and the opaque scene's actual view Z.
      // Passing an owned texture prevents convertToTexture's implicit RTT leak.
      linearBeauty = createOwnedRtt(correctedBeauty)
      loungeDof = createOwnedLoungeDof(
        linearBeauty.node,
        inputs.surface.getViewZNode(),
        loungeFocus,
      )
    }
    composite = createOwnedRtt(renderOutput(loungeDof?.node ?? correctedBeauty))
    antialias = smaa(composite.node)
    pipeline.outputNode = antialias
    pipeline.needsUpdate = true
  }
  function resetHistory() {
    if (disposed) return
    reflectionResolve?.resetHistory()
  }
  // Native beauty already contains IBL. Only temporal reprojection owns history.
  // Build once; pose cuts invalidate its history without rebuilding DOF/SMAA.
  compose()
  return {
    render() {
      RendererUtils.saveRendererState(renderer, savedState)
      const xr = renderer.xr.enabled,
        opaque = renderer.opaque,
        transparent = renderer.transparent,
        context = renderer.contextNode,
        mask = camera.layers.mask,
        name = scene.name,
        override = scene.overrideMaterial
      try {
        renderer.getDrawingBufferSize(frameSize)
        loungeFocus.prepare()
        reflectionResolve?.prepare(frameSize.x, frameSize.y)
        pipeline.render()
      } finally {
        RendererUtils.restoreRendererState(renderer, savedState)
        renderer.xr.enabled = xr
        renderer.opaque = opaque
        renderer.transparent = transparent
        renderer.contextNode = context
        camera.layers.mask = mask
        scene.name = name
        scene.overrideMaterial = override
      }
    },
    commitFrame() {
      if (!disposed && ssrEnabled && denoiseEnabled) reflectionResolve?.commitFrame()
    },
    cancelFrame() {
      reflectionResolve?.cancelFrame()
    },
    resetHistory,
    setProfile(next: RealtimeProductProfile) {
      if (disposed) return
      const enabled = resolveLoungeDof() && next.allowLoungeDof
      if (enabled === loungeFocus.enabled) return
      loungeFocus.dispose()
      loungeFocus = createLoungeDofFocus(scene, camera, enabled)
      resetHistory()
      compose()
    },
    ddgiInputs: () => ({ depth, normal, camera }),
    setWorldGi(receiver: RealtimeIrradiance | null) {
      if (disposed || receiver === worldGi) return
      worldGi = receiver
      compose()
    },
    environment() {
      const next = scene.environment,
        version = next?.version ?? -1
      if (next !== environment || version !== environmentVersion) {
        reflection.setEnvMap(next)
        environment = next
        environmentVersion = version
      }
    },
    setSignals(ssr: boolean, ssgi: boolean, denoise: boolean) {
      if (ssr === ssrEnabled && ssgi === ssgiEnabled && denoise === denoiseEnabled) return
      ssrEnabled = ssr
      ssgiEnabled = ssgi
      denoiseEnabled = denoise
      resetHistory()
      compose()
    },
    snapshot: () => ({ ssr: ssrEnabled, ssgi: ssgiEnabled, denoise: denoiseEnabled }),
    sampling: () => reflectionResolve?.snapshot() ?? null,
    dispose() {
      if (disposed) return
      disposed = true
      antialias?.dispose()
      composite?.dispose()
      loungeDof?.dispose()
      linearBeauty?.dispose()
      loungeFocus.dispose()
      reflectionResolve?.dispose()
      spatialGi.dispose()
      giInput.dispose()
      reflection.dispose()
      gi.dispose()
      inputs.dispose()
      pipeline.dispose()
    },
  }
}
