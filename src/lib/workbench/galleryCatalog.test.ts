import { expect, test } from 'vitest'
import { filterGallery, galleryItems } from './galleryCatalog'
import type { ProductSummary } from './types'

const item: ProductSummary = {
  slug: 'new-clock',
  name: '机械时钟',
  description: '观察齿轮',
  category: '机械',
  displayStatus: 'formal',
  cover: '/covers/clock.webp',
}
test('new formal exhibits enter the gallery without adding their slug to a whitelist', () => {
  expect(galleryItems([item])).toEqual([item])
  expect(
    galleryItems([
      { ...item, displayStatus: 'prototype' },
      { ...item, slug: 'gamepad' },
    ]),
  ).toEqual([])
})
test('search and category intersect and preserve API ordering without changing source data', () => {
  const items = galleryItems([
    item,
    { ...item, slug: 'new-piano', name: '钢琴', description: '琴弦', category: '乐器' },
  ])
  expect(filterGallery(items, '齿轮', '机械')).toEqual([items[0]])
  expect(filterGallery(items, '齿轮', '乐器')).toEqual([])
  expect(filterGallery(items, ' ', '')).toEqual(items)
  expect(items).toHaveLength(2)
})
