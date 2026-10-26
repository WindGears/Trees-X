import { Group, Scene } from 'three'
import { expect, it } from 'vitest'
import { realtimeSignalIdentity } from './signalIdentity'
import { reventonRealtimeProfile } from './productProfile'

it('separates multisample and native car graphs without granting custom assets studio capability', () => {
  const scene = new Scene(),
    root = new Group()
  root.userData.adapter = 'reventon-v1'
  scene.add(root)
  const profile = reventonRealtimeProfile
  expect(realtimeSignalIdentity(scene, profile, '?carAntialias=msaa')).toBe('reventon-v1')
  root.userData.carStudioQuality = 'studio'
  expect(realtimeSignalIdentity(scene, profile, '')).toBe('reventon-v1:studio:2')
  expect(realtimeSignalIdentity(scene, profile, '?carAntialias=msaa')).toBe(
    'reventon-v1:studio:2:msaa4',
  )
})
