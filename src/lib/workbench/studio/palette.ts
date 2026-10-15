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
    background: '#241c17',
    ground: '#302923',
    backdrop: { top: '#33261e', middle: '#241c17', bottom: '#191511' },
    floor: '#241d17',
    pedestal: '#44392f',
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
