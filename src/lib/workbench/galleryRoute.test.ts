import { expect, test } from 'vitest'
import { galleryLocation } from './galleryRoute'

test('cover and direct exhibit entry establish the same pipeline before stage creation', () => {
  const base = 'http://127.0.0.1:5181/?gallery=next'
  expect(galleryLocation(base)).toBe('/?gallery=next&renderPipeline=showcase')
  expect(galleryLocation(base, 'typewriter-study')).toBe(
    '/?gallery=next&renderPipeline=showcase&product=typewriter-study',
  )
  expect(galleryLocation(base + '&product=typewriter-study')).toContain('renderPipeline=showcase')
})

test('switching and returning to the cover preserve an explicitly requested compatibility backend', () => {
  const base = 'http://127.0.0.1:5181/?gallery=next&renderPipeline=webgl&product=typewriter-study'
  expect(galleryLocation(base, 'piano-cfx')).toBe(
    '/?gallery=next&renderPipeline=webgl&product=piano-cfx',
  )
  expect(galleryLocation(base, '')).toBe('/?gallery=next&renderPipeline=webgl')
})
