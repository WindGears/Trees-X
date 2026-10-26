import type { ReventonGpuDependencies } from '../reventonAdapter'
import { createReventonStageWithShadow } from '../reventonStage'
import { bindGpuAreaLights } from './studioEnvironment'
import { createGpuReventonShadow } from './reventonShadow'
import { prepareGpuReventonMaterials } from './reventonGlass'
import { createCarKeyAreaLight } from './realtime/carShadow/light'
import { coldStudioRequested, createColdShowroomStage } from './carShowroom/stage'
import { resolveColdStudioConfig } from './carShowroom/config'
import { createShowroomAreaLight } from './carShowroom/lights'

/** Dynamically imported only for a car on the existing WebGPU renderer. */
export const reventonGpuDependencies: ReventonGpuDependencies = {
  createStage: (renderer, scene, model, options) => {
    const showroom = coldStudioRequested(options, location.search) && Boolean(options?.camera)
    const showroomConfig = resolveColdStudioConfig(location.search)
    const base = createReventonStageWithShadow(
      scene,
      () => {
        bindGpuAreaLights()
        return createGpuReventonShadow(renderer, scene, model)
      },
      showroom
        ? {
            ...options,
            createKeyLight: () => createShowroomAreaLight(renderer, showroomConfig.lights.key),
            createStripLight: () => createShowroomAreaLight(renderer, showroomConfig.lights.strip),
          }
        : options?.quality === 'studio' &&
            new URLSearchParams(location.search).get('carKeyShadow') === '1'
          ? { ...options, createKeyLight: () => createCarKeyAreaLight(renderer) }
          : options,
    )
    try {
      return showroom && options?.camera
        ? createColdShowroomStage(renderer, scene, model, options.camera, base)
        : base
    } catch (cause) {
      base.dispose()
      throw cause
    }
  },
  prepareMaterials: prepareGpuReventonMaterials,
}
