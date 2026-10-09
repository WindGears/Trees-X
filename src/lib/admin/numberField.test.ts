// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import AdminNumber from '@/components/admin/AdminNumber.vue'
import { createProductDraft, provideProductDraft } from './productDraft'
import { parseProduct } from '@/lib/workbench/api'
test('the rendered numeric field preserves a cleared input, blocks submission, and releases deleted-field buffers', async () => {
  const samples: unknown[] = JSON.parse(
    readFileSync('server/src/main/resources/samples/products.json', 'utf8'),
  )
  const product = parseProduct(samples[0])
  const draft = createProductDraft(
    {
      item: {
        ...product,
        categoryId: 1,
        cover: null,
        displayStatus: 'prototype',
        revision: 0,
        listed: true,
        sortOrder: 0,
      },
      presentation: product.presentation,
    },
    false,
  )
  const original = draft.presentation.value.camera.minDistance
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup() {
      provideProductDraft(draft)
      return () =>
        h(AdminNumber, {
          modelValue: draft.presentation.value.camera.minDistance,
          path: 'camera.minDistance',
          label: '最近距离',
          section: 'camera',
          'onUpdate:modelValue': (value: number) => {
            draft.presentation.value.camera.minDistance = value
          },
        })
    },
  })
  try {
    app.mount(host)
    const input = host.querySelector('input')!
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(input.value).toBe('')
    expect(draft.presentation.value.camera.minDistance).toBe(original)
    expect(() => draft.payload()).toThrow('修正')
    input.value = '2.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(draft.payload().presentation.camera.minDistance).toBe(2.5)
  } finally {
    app.unmount()
    host.remove()
  }
  expect(draft.numbers['camera.minDistance']).toBeUndefined()
})
