import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProduct } from './api'
import { defaultStage } from './presentationV2'
import type { WorkbenchProduct } from './types'

function fixture() {
  return {
    slug: 'piano-contract',
    name: '钢琴结构教学模型',
    category: '机械结构',
    description: '只验证钢琴展示契约，不代表实际资产的几何或演示质量。',
    presentation: {
      version: 3 as const,
      source: {
        kind: 'glb' as const,
        adapter: 'piano-v1' as const,
        bundle: {
          id: 'piano-contract',
          version: 1,
          manifest: '/models/bundles/piano-contract/v1/manifest.json',
          sha256: '0'.repeat(64),
        },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
        finishMaterials: [],
        explode: [],
      },
      camera: { position: [3, 2, 5], target: [0, 1, 0], minDistance: 1, maxDistance: 12 },
      views: [{ id: 'perspective', label: '全景', position: [3, 2, 5], target: [0, 1, 0] }],
      hotspots: [],
      finishes: [{ id: 'default', name: '原始材质', color: '#202020' }],
      actions: [
        {
          id: 'sound-path',
          label: '探索声音路径',
          kind: 'progress' as const,
          node: 'piano-product',
          motion: {
            duration: 7,
            openLabel: '探索结构',
            closeLabel: '回到完整钢琴',
            program: { type: 'piano-sound-path-v1' as const, file: 'rig.json' },
          },
        },
      ],
      structure: true,
      structureActionId: 'sound-path',
      guide: [
        {
          id: 'overview',
          title: '完整结构',
          description: '观察教学模型的整体结构。',
          progress: { actionId: 'sound-path', value: 0 },
        },
      ],
      stage: structuredClone(defaultStage),
    },
  } satisfies WorkbenchProduct
}

function altered(change: Record<string, unknown>) {
  const product = fixture()
  return { ...product, presentation: { ...product.presentation, ...change } }
}

describe('registered piano presentation contract', () => {
  it('preserves the registered GLB adapter, program and guide progress through JSON', () => {
    const product = fixture()
    expect(parseProduct(JSON.parse(JSON.stringify(product)) as unknown)).toEqual({
      ...product,
      displayStatus: 'prototype',
    })
    const source = { ...product.presentation.source }
    const motion = { ...product.presentation.actions[0]!.motion }
    motion.program = { ...motion.program, file: 'motion/rig-v1.json' }
    expect(
      parseProduct(altered({ source, actions: [{ ...product.presentation.actions[0], motion }] }))
        .presentation.actions[0]!.motion?.program?.file,
    ).toBe('motion/rig-v1.json')
  })

  it.each(['pbr-v1', 'typewriter-v1', 'execute-js'])(
    '%s cannot drive the piano program',
    (adapter) => {
      const source = { ...fixture().presentation.source, adapter }
      expect(() => parseProduct(altered({ source }))).toThrow()
    },
  )

  it.each(['typewriter-layout-v1', 'execute-js'])('rejects mismatched program %s', (type) => {
    const action = fixture().presentation.actions[0]!
    const motion = { ...action.motion, program: { type, file: 'rig.json' } }
    expect(() => parseProduct(altered({ actions: [{ ...action, motion }] }))).toThrow()
  })

  it.each([1, 2])('requires v3 instead of version %s', (version) => {
    expect(() => parseProduct(altered({ version }))).toThrow()
  })

  it.each([
    '../rig.json',
    '/rig.json',
    'https://example.com/rig.json',
    'motion//rig.json',
    'motion/./rig.json',
    'motion\\rig.json',
    'rig.json?code=1',
    '',
  ])('rejects unsafe motion path %s', (file) => {
    const action = fixture().presentation.actions[0]!
    const motion = { ...action.motion, program: { ...action.motion.program, file } }
    expect(() => parseProduct(altered({ actions: [{ ...action, motion }] }))).toThrow()
  })

  it('requires exactly one program progress tied to the structure action', () => {
    const action = fixture().presentation.actions[0]!
    for (const change of [
      { actions: [] },
      { actions: [action, { ...action, id: 'other-progress' }] },
      { structureActionId: 'missing' },
      { structureActionId: undefined },
      { structure: false },
      { actions: [{ ...action, kind: 'toggle' }] },
      { actions: [{ ...action, motion: undefined }] },
    ])
      expect(() => parseProduct(altered(change))).toThrow()
  })

  it('rejects competing tracks, explosions and every discrete behavior', () => {
    const product = fixture(),
      action = product.presentation.actions[0]!,
      tracks = [{ node: 'key', type: 'translate', offset: [0, -0.01, 0], range: [0, 1] }]
    for (const change of [
      { actions: [{ ...action, motion: { ...action.motion, tracks } }] },
      { actions: [{ ...action, motion: { ...action.motion, program: undefined, tracks } }] },
      { source: { ...product.presentation.source, explode: [{ node: 'key', offset: [0, 1, 0] }] } },
      { actions: [{ ...action, behavior: { type: 'translate', axis: [0, 1, 0], amount: 1 } }] },
      {
        actions: [
          action,
          {
            id: 'rotate-key',
            label: '其他动作',
            kind: 'toggle',
            node: 'key',
            behavior: { type: 'rotate', axis: [1, 0, 0], amount: 1 },
          },
        ],
      },
      {
        actions: [
          action,
          {
            id: 'strike',
            label: '打字机击发',
            kind: 'pulse',
            node: 'key',
            behavior: { type: 'typewriter-strike', index: 0 },
          },
        ],
      },
    ])
      expect(() => parseProduct(altered(change))).toThrow()
  })

  it('keeps typewriter programs and existing track presentations compatible', () => {
    const typewriter = JSON.parse(
      readFileSync('server/src/main/resources/presentations/typewriter-kimi-v1.json', 'utf8'),
    ) as unknown
    expect(parseProduct(typewriter).presentation.source).toMatchObject({ adapter: 'typewriter-v1' })
    const samples: unknown = JSON.parse(
      readFileSync('server/src/main/resources/samples/progress-products.json', 'utf8'),
    )
    expect(Array.isArray(samples)).toBe(true)
    if (!Array.isArray(samples)) throw new Error('Missing progress fixtures')
    for (const sample of samples) expect(() => parseProduct(sample)).not.toThrow()
  })
})
