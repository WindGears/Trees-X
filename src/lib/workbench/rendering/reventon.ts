import type { ReventonGpuDependencies } from '../reventonAdapter'
import { createReventonStageWithShadow } from '../reventonStage'
import { bindGpuAreaLights } from './studioEnvironment'
import { createGpuReventonShadow } from './reventonShadow'
import { prepareGpuReventonMaterials } from './reventonGlass'

/** Dynamically imported only for a car on the existing WebGPU renderer. */
export const reventonGpuDependencies: ReventonGpuDependencies = {
  createStage: (renderer, scene, model, options) =>
    createReventonStageWithShadow(
      scene,
      () => {
        bindGpuAreaLights()
        return createGpuReventonShadow(renderer, scene, model)
      },
      options,
    ),
  prepareMaterials: prepareGpuReventonMaterials,
}
