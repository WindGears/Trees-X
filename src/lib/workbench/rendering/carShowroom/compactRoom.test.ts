import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { reventonMotionEnvelope } from '../realtime/productProfile'
import {
  compactColdStudioConfig,
  balancedColdStudioConfig,
  rimColdStudioConfig,
  stoneColdStudioConfig,
  coldStudioConfig,
  resolveColdStudioConfig,
} from './config'
import { createColdStudioGeometry } from './geometry'

describe('compact studio physical envelope', () => {
  it('changes only the floor tint for the ground-return study', () => {
    const { revision, floor, ...room } = stoneColdStudioConfig
    const { revision: previous, floor: oldFloor, ...oldRoom } = rimColdStudioConfig
    expect(revision).toBe(previous + 1)
    expect(room).toEqual(oldRoom)
    expect(floor).toEqual({ ...oldFloor, color: '#dddddd' })
    expect(resolveColdStudioConfig('?carStudioFinish=stone')).toBe(stoneColdStudioConfig)
  })
  it.each([compactColdStudioConfig, balancedColdStudioConfig, rimColdStudioConfig])(
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
    expect(resolveColdStudioConfig('?carStudioFinish=rim')).toBe(rimColdStudioConfig)
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
  it('changes only rim placement and aspect ratio, preserving emitting area and radiance', () => {
    const {
      revision: previousRevision,
      lights: previousLights,
      ...previousRoom
    } = balancedColdStudioConfig
    const { revision, lights, ...room } = rimColdStudioConfig
    expect(revision).toBe(previousRevision + 1)
    expect(room).toEqual(previousRoom)
    for (const id of ['key', 'strip', 'fill'] as const)
      expect(lights[id]).toEqual(previousLights[id])
    expect(lights.rim.width * lights.rim.height).toBeCloseTo(
      previousLights.rim.width * previousLights.rim.height,
      12,
    )
    expect(lights.rim.radiance).toBe(previousLights.rim.radiance)
    expect(lights.rim.intensity).toBe(previousLights.rim.intensity)
    expect(lights.rim.color).toBe(previousLights.rim.color)
    expect(lights.rim.position).toEqual([-3.75, 2.25, 6.86])
  })
})
