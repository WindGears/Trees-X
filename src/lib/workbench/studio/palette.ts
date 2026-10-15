import { studioDesign } from './design'

/** Visible stage colors only: the authored HDR and softboxes remain independent. */
export const studioPalettes = {
  light: {
    mood: 'light',
    background: '#e7e9e5',
    ground: '#d8dcd5',
    backdrop: studioDesign.backdrop,
    floor: studioDesign.floor,
    pedestal: studioDesign.pedestal,
  },
  dark: {
    mood: 'dark',
    background: '#333f39',
    ground: '#3f4944',
    backdrop: { top: '#505c55', middle: '#333f39', bottom: '#242e29' },
    floor: '#2e3832',
    pedestal: '#3f4944',
  },
} as const

export type StudioPalette = (typeof studioPalettes)[keyof typeof studioPalettes]

export function resolveStudioPalette(
  realtime = false,
  search = typeof location === 'undefined' ? '' : location.search,
): StudioPalette {
  return realtime && new URLSearchParams(search).get('studioMood') !== 'light'
    ? studioPalettes.dark
    : studioPalettes.light
}
