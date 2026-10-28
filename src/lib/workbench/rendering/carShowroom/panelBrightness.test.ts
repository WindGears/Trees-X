import { expect, it } from 'vitest'
import { Box3, MeshBasicMaterial, PerspectiveCamera, RectAreaLight, Scene } from 'three'
import { createColdStudioGeometry } from './geometry'
import { createShowroomCutaway } from './fade'
import {
  ownShowroomPanelBrightness,
  setShowroomPanelBrightness,
  setShowroomLighting,
} from './panelBrightness'

it('scales real lights, baked radiance and visible panels together without cumulative drift', () => {
  const room = createColdStudioGeometry(),
    scene = new Scene(),
    light = new RectAreaLight('#ffffff', 7),
    panel = room.panels[0]!.material as MeshBasicMaterial,
    initial = panel.color.clone()
  let ready = false,
    reported = 1
  const owner = ownShowroomPanelBrightness(
    scene,
    room.panels,
    () => ready,
    () => {},
    {
      scene,
      baseline: 1,
      lights: () => [light],
      report: (value) => {
        reported = value
      },
    },
  )
  expect(setShowroomLighting(scene, 2)).toBeUndefined()
  ready = true
  setShowroomPanelBrightness(scene, 0.5)
  for (let index = 0; index < 50; index++) {
    expect(setShowroomLighting(scene, 2)).toBe(2)
    expect(light.intensity).toBe(14)
    expect(scene.environmentIntensity).toBe(2)
    expect(panel.color.equals(initial)).toBe(true)
    setShowroomLighting(scene, 1)
  }
  expect(light.intensity).toBe(7)
  expect(reported).toBe(1)
  expect(setShowroomLighting(scene, -5)).toBe(0.25)
  expect(setShowroomLighting(scene, 8)).toBe(2)
  expect(setShowroomLighting(scene, Infinity)).toBeUndefined()
  expect(light.intensity).toBe(14)
  owner.dispose()
  owner.dispose()
  expect(light.intensity).toBe(7)
  expect(scene.environmentIntensity).toBe(1)
  expect(panel.color.equals(initial)).toBe(true)
  expect(setShowroomLighting(scene, 1)).toBeUndefined()
  room.dispose()
})

it('only scales visible clones, clamps inputs and restores on disposal', () => {
  const room = createColdStudioGeometry(),
    scene = new Scene(),
    fade = createShowroomCutaway(room.fadeMeshes, new PerspectiveCamera(), new Box3()),
    panel = room.panels[0]!,
    material = panel.material as MeshBasicMaterial,
    source = panel.userData.traceMaterial as MeshBasicMaterial,
    original = material.color.clone()
  let ready = false,
    reported = 1
  const owner = ownShowroomPanelBrightness(
    scene,
    room.panels,
    () => ready,
    (value) => {
      reported = value
    },
  )
  expect(setShowroomPanelBrightness(scene, 2)).toBeUndefined()
  ready = true
  expect(setShowroomPanelBrightness(scene, 2)).toBe(2)
  expect(material.color.r).toBe(original.r * 2)
  expect(source.color.equals(original)).toBe(true)
  expect(reported).toBe(2)
  expect(setShowroomPanelBrightness(scene, -10)).toBe(0)
  expect(material.color.r).toBe(0)
  expect(setShowroomPanelBrightness(scene, 10)).toBe(3)
  expect(setShowroomPanelBrightness(scene, NaN)).toBeUndefined()
  owner.dispose()
  owner.dispose()
  expect(material.color.equals(original)).toBe(true)
  expect(setShowroomPanelBrightness(scene, 2)).toBeUndefined()
  fade.dispose()
  room.dispose()
})

it('retiring an old owner cannot unregister a newer scene control', () => {
  const scene = new Scene(),
    a = createColdStudioGeometry(),
    b = createColdStudioGeometry(),
    old = ownShowroomPanelBrightness(
      scene,
      a.panels,
      () => true,
      () => {},
    ),
    current = ownShowroomPanelBrightness(
      scene,
      b.panels,
      () => true,
      () => {},
    )
  old.dispose()
  expect(setShowroomPanelBrightness(scene, 1.5)).toBe(1.5)
  current.dispose()
  a.dispose()
  b.dispose()
})
