import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { collection } from './collection'
import { storyFor } from './exhibition'
import { useProductStore } from '@/stores/product'
beforeEach(() => setActivePinia(createPinia()))
it('each featured story resolves real product parts and supported structural views', () => {
  const heroes = collection.filter((product) => product.featuredRank)
  expect(heroes.map((product) => product.id).sort()).toEqual([
    'form-01',
    'potted-plant',
    'toy-racer',
  ])
  for (const product of collection) {
    for (const step of storyFor(product)) {
      if (step.partId) expect(product.hotspots.some((part) => part.id === step.partId)).toBe(true)
      if (step.view === 'structure') expect(product.structure.length).toBeGreaterThan(0)
    }
    if (product.featuredRank) expect(storyFor(product)).toHaveLength(3)
  }
})
it('closing panels keeps observation; returning to overview assembles but preserves the finish', () => {
  const store = useProductStore()
  expect(store.product.id).toBe('form-01')
  expect(store.panel).toBeNull()
  store.finishId = 'champagne'
  store.setStructure(true)
  store.focusPart('dial')
  store.openPanel('details')
  store.openPanel(null)
  expect(store.finishId).toBe('champagne')
  expect(store.exploded).toBe(true)
  expect(store.viewPreset).toBe('detail')
  store.returnToOverview()
  expect(store.exploded).toBe(false)
  expect(store.viewPreset).toBe('perspective')
  expect(store.finishId).toBe('champagne')
})
it('selecting a different asset advances the revision and discards the old guide', () => {
  const store = useProductStore()
  store.goToGuideStep(1)
  const revision = store.selectionRevision
  store.selectProduct('potted-plant')
  expect(store.selectionRevision).toBe(revision + 1)
  expect(store.guideStep).toBeNull()
  store.goToGuideStep(2)
  expect(store.activePartId).toBe('potted-plant-01-pebbles')
  expect(store.exploded).toBe(false)
})
