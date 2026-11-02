import { Box3, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  bounceColdStudioConfig,
  rimColdStudioConfig,
  resolveColdStudioConfig,
  coldStudioConfig,
} from './config'
import { createColdStudioGeometry } from './geometry'

describe('floor bounce studio candidate', () => {
  it('requires an explicit candidate selection and leaves default and rim intact', () => {
    expect(resolveColdStudioConfig('?carStudioFinish=bounce')).toBe(bounceColdStudioConfig)
    expect(resolveColdStudioConfig('?carStudioFinish=rim')).toBe(rimColdStudioConfig)
    expect(resolveColdStudioConfig('')).toBe(coldStudioConfig)
  })
  it('keeps the room and capture budget while changing only the existing fill', () => {
    const { revision: _old, lights: oldLights, ...old } = rimColdStudioConfig
    const { revision: _next, lights: nextLights, ...next } = bounceColdStudioConfig
    expect(next).toEqual(old)
    expect(Object.keys(nextLights)).toEqual(Object.keys(oldLights))
    for (const id of ['key', 'strip', 'rim'] as const) expect(nextLights[id]).toEqual(oldLights[id])
    expect(nextLights.fill.width * nextLights.fill.height).toBeCloseTo(
      oldLights.fill.width * oldLights.fill.height,
    )
    expect(nextLights.fill.intensity).toBe(nextLights.fill.radiance)
    expect(_next).toBeGreaterThan(_old)
  })

  it('keeps tilted fixture geometry inside the room and exposes its diffuser to the probe', () => {
    const config = bounceColdStudioConfig
    const room = createColdStudioGeometry(config)
    const previous = createColdStudioGeometry(rimColdStudioConfig)
    try {
      expect(room.root.children.length).toBe(previous.root.children.length)
      expect(room.panels.length).toBe(4)
      const panel = room.panels.find((node) => node.userData.showroomLightId === 'fill')!
      const bounds = new Box3().setFromObject(panel)
      expect(bounds.min.y).toBeGreaterThan(config.groundY)
      expect(bounds.max.y).toBeLessThan(config.roomBox.max[1])
      expect(bounds.max.x).toBeLessThan(config.roomBox.max[0])
      const origin = new Vector3(...config.capture.position)
      const ray = new Raycaster(origin, panel.position.clone().sub(origin).normalize())
      expect(ray.intersectObject(room.root, true)[0]?.object).toBe(panel)
    } finally {
      room.dispose()
      previous.dispose()
    }
  })
})
