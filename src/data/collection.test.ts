import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three'
import { collection } from './collection'
import { useProductStore } from '@/stores/product'
import { createModelPresentation } from '@/lib/three/presentation'
import { disposeModel } from '@/lib/three/model'

beforeEach(() => setActivePinia(createPinia()))

it('matches every imported GLB node, checksum and rendered triangle budget', async () => {
  const manifest: { id: string; sha256: string; bytes: number; triangles: number }[] = JSON.parse(
    await readFile(
      new URL('../../public/models/collection/manifest.json', import.meta.url),
      'utf8',
    ),
  )
  expect(new Set(collection.map((p) => p.id)).size).toBe(8)
  for (const entry of manifest) {
    const product = collection.find((p) => p.id === entry.id)!
    const bytes = await readFile(
      new URL(`../../public/models/collection/${entry.id}.glb`, import.meta.url),
    )
    const json: {
      nodes: { name: string; mesh?: number }[]
      meshes: { primitives: { indices: number }[] }[]
      accessors: { count: number }[]
    } = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
    expect(bytes.length).toBe(entry.bytes)
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
    const triangles = json.nodes.reduce(
      (sum, node) =>
        sum +
        (node.mesh === undefined
          ? 0
          : json.meshes[node.mesh]!.primitives.reduce(
              (total, p) => total + json.accessors[p.indices]!.count / 3,
              0,
            )),
      0,
    )
    expect(triangles).toBe(entry.triangles)
    expect(triangles).toBeLessThan(100000)
    const names = json.nodes.map((n) => n.name)
    for (const name of [
      product.finishNode,
      ...product.hotspots.map((p) => p.node),
      ...product.structure.flatMap((p) => p.nodes),
    ])
      expect(names, `${entry.id}: ${name}`).toContain(name)
  }
})

it('resets product-specific state and exposes only supported guide steps', () => {
  const store = useProductStore()
  store.focusPart('dial')
  store.finishId = 'champagne'
  store.setStructure(true)
  store.catalogOpen = true
  expect(store.selectProduct('gamepad')).toBe(true)
  expect(store.catalogOpen).toBe(false)
  expect(store.activePartId).toBe('gamepad')
  expect(store.finishId).toBe('original')
  expect(store.status).toBe('loading')
  expect(store.exploded).toBe(false)
  store.setStructure(true)
  expect(store.exploded).toBe(false)
  store.goToGuideStep(2)
  expect(store.guideStep).toBe(1)
  expect(store.viewPreset).toBe('detail')
  expect(store.selectProduct('unknown')).toBe(false)
  expect(store.product.id).toBe('gamepad')
  store.selectProduct('toy-racer')
  store.goToGuideStep(2)
  expect(store.exploded).toBe(true)
  expect(store.guideLength).toBe(3)
})

it('keeps world-space expansion consistent across normalized scales and restores textured originals', () => {
  const root = new Group()
  root.scale.setScalar(8)
  const original = new MeshStandardMaterial({ color: '#aa8866', roughness: 0.83 })
  const mesh = new Mesh(new BoxGeometry(), original)
  mesh.name = 'cover'
  root.add(mesh)
  root.updateMatrixWorld(true)
  const product = {
    ...collection[2]!,
    finishNode: 'cover',
    structure: [{ nodes: ['cover'], offset: [0, 0.6, 0] as [number, number, number] }],
  }
  const view = createModelPresentation(root, product)
  view.setExpansion(1)
  expect(mesh.position.y * root.scale.y).toBeCloseTo(0.6)
  view.setFinish(product.finishes[1]!)
  view.setFinish(product.finishes[0]!)
  expect(mesh.material.color.equals(original.color)).toBe(true)
  expect(mesh.material.roughness).toBe(0.83)
  view.dispose()
  expect(mesh.material).toBe(original)
  expect(mesh.position.y).toBe(0)
  disposeModel(root)
})
