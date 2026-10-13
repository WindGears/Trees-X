import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProduct } from './api'
import { hasTypewriterStudio, resolveWorkbenchStage } from './studioPreset'
import { defaultStage } from './presentationV2'

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
})
