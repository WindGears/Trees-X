// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { parseProduct } from '@/lib/workbench/api'
import { createProductDraft } from './productDraft'
import { applyCameraCapture, copy, moveItem, nextId, removalReasons } from './editor'
import type { AdminDetail } from './api'
function detail(progress = false): AdminDetail {
  const samples: unknown[] = JSON.parse(
    readFileSync(
      `server/src/main/resources/samples/${progress ? 'progress-products' : 'products'}.json`,
      'utf8',
    ),
  )
  const product = parseProduct(samples[0])
  return {
    item: {
      ...product,
      categoryId: 1,
      cover: product.cover ?? null,
      displayStatus: 'prototype',
      revision: 4,
      listed: true,
      sortOrder: 0,
    },
    presentation: product.presentation,
  }
}
test('form and JSON round trips retain source, optional anchors, motion tracks and original version', () => {
  for (const progress of [false, true]) {
    const original = detail(progress),
      draft = createProductDraft(original, false)
    draft.presentation.value.hotspots[0]!.description = '修改说明'
    const json = JSON.parse(draft.json.value)
    json.finishes[0].name = '新的外观名称'
    draft.json.value = JSON.stringify(json)
    expect(draft.advancedDirty.value).toBe(true)
    expect(() => draft.payload()).toThrow('尚未应用')
    expect(draft.applyJson()).toBe(true)
    expect(draft.payload().presentation.version).toBe(original.presentation.version)
    expect(draft.payload().presentation.source).toEqual(original.presentation.source)
    expect(draft.payload().presentation.actions).toEqual(original.presentation.actions)
    expect(draft.payload().presentation.hotspots[0]!.description).toBe('修改说明')
    expect(original.presentation.finishes[0]!.name).not.toBe('新的外观名称')
  }
})
test('invalid JSON and empty numeric buffers never replace a valid draft or silently become zero', () => {
  const draft = createProductDraft(detail(true), false),
    initial = copy(draft.presentation.value)
  draft.json.value = '{'
  expect(draft.applyJson()).toBe(false)
  expect(draft.presentation.value).toEqual(initial)
  draft.discardJson()
  draft.numbers['camera.minDistance'] = ''
  draft.numberLabels['camera.minDistance'] = { section: 'camera', label: '最近距离' }
  expect(draft.dirty.value).toBe(true)
  expect(draft.issues.value.some((i) => i.path === 'camera.minDistance')).toBe(true)
  expect(draft.presentation.value.camera.minDistance).toBe(initial.camera.minDistance)
  expect(() => draft.payload()).toThrow('修正')
})
test('stable ids, reordering and deletion guards keep references and defaults intact', () => {
  const p = detail(true).presentation
  const id = nextId(p.hotspots, 'part')
  p.hotspots.push({ ...copy(p.hotspots[0]!), id })
  expect(nextId(p.hotspots, 'part')).not.toBe(id)
  const bound = p.guide.find((s) => s.hotspotId)!.hotspotId!
  expect(removalReasons(p, 'hotspots', bound)[0]).toContain('导览')
  expect(removalReasons(p, 'views', 'perspective')).toHaveLength(1)
  p.finishes.splice(1)
  expect(removalReasons(p, 'finishes', p.finishes[0]!.id)).toHaveLength(1)
  moveItem(p.hotspots, p.hotspots.length - 1, -1)
  expect(p.hotspots[p.hotspots.length - 2]!.id).toBe(id)
  expect(p.guide.find((s) => s.hotspotId)!.hotspotId).toBe(bound)
})
test('capture changes only the chosen view; default capture synchronizes reset pose and preserves limits', () => {
  const p = detail(true).presentation,
    before = copy(p)
  const pose = {
    position: [2, 2, 4] as [number, number, number],
    target: [0, 1, 0] as [number, number, number],
  }
  const named = p.views.find((v) => v.id !== 'perspective')!
  applyCameraCapture(p, 'view:' + named.id, pose)
  expect(p.camera).toEqual(before.camera)
  expect(named.position).toEqual(pose.position)
  applyCameraCapture(p, 'default', pose)
  expect(p.camera.position).toEqual(p.views.find((v) => v.id === 'perspective')!.position)
  expect(p.camera.minDistance).toBe(before.camera.minDistance)
  expect(p.actions).toEqual(before.actions)
  expect(() => applyCameraCapture(p, 'missing', pose)).toThrow('不存在')
})
test('leaving unapplied JSON needs an explicit discard, and server success becomes the new canonical baseline', () => {
  const draft = createProductDraft(detail(true), false)
  draft.choose('advanced')
  draft.json.value = '{'
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
  draft.choose('info')
  expect(draft.section.value).toBe('advanced')
  vi.mocked(window.confirm).mockReturnValue(true)
  draft.choose('info')
  expect(draft.json.value).not.toBe('{')
  const saved = detail(true)
  saved.item.revision = 12
  saved.presentation.finishes[0]!.name = '服务端返回'
  draft.accept(saved)
  expect(draft.item.value.revision).toBe(12)
  expect(draft.presentation.value.finishes[0]!.name).toBe('服务端返回')
  expect(draft.dirty.value).toBe(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
test('GLB v2 form round trip preserves bundle, stage, materials, transform and parameterized behaviors', () => {
  const fixture: unknown = JSON.parse(
    readFileSync('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
  )
  const base = detail(),
    product = parseProduct(fixture)
  base.presentation = product.presentation
  const draft = createProductDraft(base, false)
  draft.presentation.value.finishes[0]!.name = 'GLB外观'
  const roundtrip = draft.payload().presentation
  expect(roundtrip.version).toBe(2)
  expect(roundtrip.source).toEqual(product.presentation.source)
  expect(roundtrip.stage).toEqual(product.presentation.stage)
  expect(roundtrip.actions).toEqual(product.presentation.actions)
})
