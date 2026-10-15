import { afterEach, describe, expect, it, vi } from 'vitest'
import { studioDesign } from './design'
import { resolveStudioPalette, studioPalettes } from './palette'

afterEach(() => vi.unstubAllGlobals())

describe('visible studio palette selection', () => {
  it('keeps non-realtime stages on the original authored palette regardless of the URL', () => {
    for (const search of ['', '?studioMood=dark', '?studioMood=light', '?studioMood=invalid']) {
      expect(resolveStudioPalette(false, search)).toBe(studioPalettes.light)
    }
    expect(studioPalettes.light.backdrop).toEqual(studioDesign.backdrop)
    expect(studioPalettes.light.floor).toBe(studioDesign.floor)
    expect(studioPalettes.light.pedestal).toBe(studioDesign.pedestal)
  })

  it('uses the dark realtime candidate unless the original light comparison is explicitly selected', () => {
    for (const search of ['', '?studioMood=dark', '?studioMood=', '?studioMood=invalid']) {
      expect(resolveStudioPalette(true, search)).toBe(studioPalettes.dark)
    }
    expect(resolveStudioPalette(true, '?studioMood=light')).toBe(studioPalettes.light)
    expect(studioPalettes.dark).toMatchObject({
      mood: 'dark',
      background: '#241c17',
      backdrop: { top: '#33261e', middle: '#241c17', bottom: '#191511' },
      floor: '#241d17',
      pedestal: '#44392f',
    })
  })

  it('reads the current comparison URL without mutating the shared design or palettes', () => {
    const before = JSON.stringify({ studioDesign, studioPalettes })
    vi.stubGlobal('location', new URL('http://localhost/?studioMood=light'))
    expect(resolveStudioPalette(true)).toBe(studioPalettes.light)
    vi.stubGlobal('location', new URL('http://localhost/?studioMood=dark'))
    expect(resolveStudioPalette(true)).toBe(studioPalettes.dark)
    expect(resolveStudioPalette()).toBe(studioPalettes.light)
    expect(JSON.stringify({ studioDesign, studioPalettes })).toBe(before)
  })
})
