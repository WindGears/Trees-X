import { defaultStage } from './presentationV2'
import type { ProductPresentation, StageConfig } from './types'

export function hasTypewriterStudio(presentation?: ProductPresentation) {
  return presentation?.source.kind === 'glb' && presentation.source.adapter === 'typewriter-v1'
}

/** The registered studio is an authored lighting setup, separate from the product's motion. */
export function resolveWorkbenchStage(
  presentation: ProductPresentation | undefined,
  gallery: boolean,
): StageConfig {
  const source = presentation?.stage ?? defaultStage
  if (hasTypewriterStudio(presentation)) {
    return {
      ...source,
      background: '#e7e9e5',
      ground: '#d8dcd5',
      ambient: 0.16,
      environmentIntensity: 0.9,
      exposure: 1,
      key: { position: [-2.5, 5, 1.5], color: '#fff9ef', intensity: 0.75 },
      rim: { position: [3, 3, -2], color: '#eef3ff', intensity: 0.35 },
    }
  }
  return gallery ? { ...source, background: '#e7e9e5', ground: '#d8dcd5' } : source
}
