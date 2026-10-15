import { defaultStage } from './presentationV2'
import type { ProductPresentation, StageConfig } from './types'
import { realtimeReference } from './rendering/realtime/reference'
import { resolveStudioPalette } from './studio/palette'

export function hasTypewriterStudio(presentation?: ProductPresentation) {
  return presentation?.source.kind === 'glb' && presentation.source.adapter === 'typewriter-v1'
}

/** The registered studio is an authored lighting setup, separate from the product's motion. */
export function resolveWorkbenchStage(
  presentation: ProductPresentation | undefined,
  gallery: boolean,
  realtime = false,
): StageConfig {
  const source = presentation?.stage ?? defaultStage
  if (hasTypewriterStudio(presentation)) {
    const palette = resolveStudioPalette(realtime)
    return {
      ...source,
      background: realtime ? palette.background : '#e7e9e5',
      ground: realtime ? palette.ground : '#d8dcd5',
      ambient: realtime ? realtimeReference.supplementalLights.ambient : 0.16,
      environmentIntensity: realtime ? realtimeReference.environment.intensity : 0.9,
      exposure: 1,
      // Delta directional fills produced subpixel HDR peaks in the mirror.
      // The realtime reference retains the three authored finite softboxes.
      key: {
        position: [-2.5, 5, 1.5],
        color: '#fff9ef',
        intensity: realtime ? realtimeReference.supplementalLights.key : 0.75,
      },
      rim: {
        position: [3, 3, -2],
        color: '#eef3ff',
        intensity: realtime ? realtimeReference.supplementalLights.rim : 0.35,
      },
    }
  }
  return gallery ? { ...source, background: '#e7e9e5', ground: '#d8dcd5' } : source
}
