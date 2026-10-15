import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseProduct } from './api'
import { hasTypewriterStudio, resolveWorkbenchStage } from './studioPreset'
import { defaultStage } from './presentationV2'

afterEach(() => vi.unstubAllGlobals())

function presentation(file: string) {
  return parseProduct(JSON.parse(readFileSync(file, 'utf8')) as unknown).presentation
}
describe('registered photography studio lighting', () => {
  it('changes only lighting for the real typewriter, leaving motion and authored ground height intact', () => {
    const source = presentation('server/src/main/resources/presentations/typewriter-kimi-v1.json')
    const snapshot = JSON.stringify(source)
    const result = resolveWorkbenchStage(source, true)
    expect(hasTypewriterStudio(source)).toBe(true)
    expect(result.groundY).toBe(source.stage?.groundY)
    expect(result.ambient).toBeLessThan(source.stage!.ambient)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('keeps other products and original previews outside the studio preset', () => {
    const source = presentation(
      'server/src/main/resources/presentations/reventon-workbench-v1.json',
    )
    expect(hasTypewriterStudio(source)).toBe(false)
    expect(resolveWorkbenchStage(source, false)).toBe(source.stage)
    expect(resolveWorkbenchStage(source, false, true)).toBe(source.stage)
    expect(resolveWorkbenchStage(source, true)).toEqual({
      ...source.stage,
      background: '#e7e9e5',
      ground: '#d8dcd5',
    })
    expect(hasTypewriterStudio()).toBe(false)
    expect(resolveWorkbenchStage(undefined, false)).toBe(defaultStage)
  })
  it('removes delta fills only from the realtime typewriter reference without changing source configuration', () => {
    const source = presentation('server/src/main/resources/presentations/typewriter-kimi-v1.json'),
      snapshot = JSON.stringify(source),
      webgl = resolveWorkbenchStage(source, false),
      realtime = resolveWorkbenchStage(source, false, true)
    expect(realtime.environmentIntensity).toBe(0.35)
    expect(realtime.key.intensity).toBe(0)
    expect(realtime.rim.intensity).toBe(0)
    expect(realtime.ambient).toBe(webgl.ambient)
    expect(realtime.key.position).toEqual(webgl.key.position)
    expect(realtime.rim.position).toEqual(webgl.rim.position)
    expect(webgl.key.intensity).toBe(0.75)
    expect(webgl.rim.intensity).toBe(0.35)
    expect(webgl.environmentIntensity).toBe(0.9)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('changes only the visible realtime stage palette while retaining its calibrated lighting', () => {
    const source = presentation('server/src/main/resources/presentations/typewriter-kimi-v1.json'),
      snapshot = JSON.stringify(source)
    vi.stubGlobal('location', new URL('http://localhost/?studioMood=dark'))
    const dark = resolveWorkbenchStage(source, false, true),
      webgl = resolveWorkbenchStage(source, false)
    expect(dark.background).toBe('#333f39')
    expect(dark.ground).toBe('#3f4944')
    expect(webgl.background).toBe('#e7e9e5')
    expect(webgl.ground).toBe('#d8dcd5')
    vi.stubGlobal('location', new URL('http://localhost/?studioMood=light'))
    const light = resolveWorkbenchStage(source, false, true)
    expect(light.background).not.toBe(dark.background)
    expect(light.ground).not.toBe(dark.ground)
    expect({ ...dark, background: light.background, ground: light.ground }).toEqual(light)
    expect(dark.exposure).toBe(1)
    expect(dark.environmentIntensity).toBe(0.35)
    expect(dark.ambient).toBe(0.16)
    expect(dark.key.intensity).toBe(0)
    expect(dark.rim.intensity).toBe(0)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
})
