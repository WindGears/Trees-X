import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { reventonMotionEnvelope } from '../realtime/productProfile'
import {
  compactColdStudioConfig,
  balancedColdStudioConfig,
  coldStudioConfig,
  resolveColdStudioConfig,
} from './config'
import { createColdStudioGeometry } from './geometry'

describe('compact studio physical envelope', () => {
  it.each([compactColdStudioConfig, balancedColdStudioConfig])(
    'r$revision keeps moving car clear of walls and fixtures',
    (config) => {
      const room = createColdStudioGeometry(config),
        motion = new Box3(
          new Vector3(...reventonMotionEnvelope.min),
          new Vector3(...reventonMotionEnvelope.max),
        ),
        inner = new Box3(new Vector3(...config.roomBox.min), new Vector3(...config.roomBox.max))
      expect(inner.containsBox(motion)).toBe(true)
      expect(config.roomBox.max[1] - motion.max.y).toBeGreaterThan(1)
      for (const panel of room.panels) {
        const bounds = new Box3().setFromObject(panel)
        expect(inner.containsBox(bounds)).toBe(true)
        expect(bounds.intersectsBox(motion)).toBe(false)
      }
      for (const mesh of room.fadeMeshes.filter((m) => m.userData.showroomSurface === 'wall'))
        expect(new Box3().setFromObject(mesh).intersectsBox(motion)).toBe(false)
      room.dispose()
    },
  )
  it('keeps the old default and selects the new room only explicitly', () => {
    expect(resolveColdStudioConfig('')).toBe(coldStudioConfig)
    expect(resolveColdStudioConfig('?carStudioFinish=unknown')).toBe(coldStudioConfig)
    expect(resolveColdStudioConfig('?carStudioFinish=compact')).toBe(compactColdStudioConfig)
    expect(resolveColdStudioConfig('?carStudioFinish=balanced')).toBe(balancedColdStudioConfig)
  })
  it('moves only the key fixture, preserving energy, room surfaces and all other lamps', () => {
    const {
      revision: previousRevision,
      lights: previousLights,
      ...previousRoom
    } = compactColdStudioConfig
    const { revision, lights, ...room } = balancedColdStudioConfig
    expect(revision).toBe(previousRevision + 1)
    expect(room).toEqual(previousRoom)
    const { position, target, ...key } = lights.key
    const {
      position: previousPosition,
      target: previousTarget,
      ...previousKey
    } = previousLights.key
    expect(key).toEqual(previousKey)
    expect(position.slice(0, 2)).toEqual(previousPosition.slice(0, 2))
    expect(target.slice(0, 2)).toEqual(previousTarget.slice(0, 2))
    expect(position[2]).toBe(-3)
    expect(target[2]).toBe(-3)
    for (const id of ['strip', 'rim', 'fill'] as const)
      expect(lights[id]).toEqual(previousLights[id])
  })
})
