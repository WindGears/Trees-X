import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { parseProduct } from './api'
import { parseBundle, loadBundle, sha256 } from './assetBundle'
import { checkGlbDocument } from './glbDocument'
import { bindGlb } from './glbAdapter'
import { ownedResources } from './ownedResources'
import { ResourceSlot } from './resourceSlot'

const fixture = () =>
  parseProduct(
    JSON.parse(
      readFileSync('server/src/test/resources/fixtures/speaker-glb-v2.json', 'utf8'),
    ) as unknown,
  )
const data = readFileSync('public/models/form-01.glb')
const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
const manifestBytes = readFileSync('public/models/bundles/speaker-engineering/v1/manifest.json')
const manifest = JSON.parse(manifestBytes.toString()) as unknown

describe('formal asset contracts and ownership', () => {
  it('accepts v2 and rejects code, remote paths, unbound actions and corrupt manifests', () => {
    const product = fixture(),
      p = product.presentation
    expect(p.version).toBe(2)
    if (p.source.kind !== 'glb') throw new Error('fixture')
    expect(() =>
      parseProduct({
        ...product,
        presentation: { ...p, source: { ...p.source, adapter: 'eval' } },
      }),
    ).toThrow('适配器')
    p.source.bundle.manifest = 'https://example.com/model.json'
    expect(() => parseProduct(product)).toThrow('同源')
    const b = parseBundle(manifest)
    expect(() => parseBundle({ ...b, files: [...b.files, b.files[0]] })).toThrow('清单')
    expect(() => parseBundle({ ...b, files: [{ ...b.files[0], path: '../model.glb' }] })).toThrow(
      '相对',
    )
    expect(() => checkGlbDocument(new ArrayBuffer(24), b)).toThrow('GLB')
    const broken = fixture()
    delete broken.presentation.actions[0]!.behavior
    expect(() => parseProduct(broken)).toThrow('绑定')
  })
  it('binds the real 104-mesh GLB without changing geometry and composes reversible motion', async () => {
    const product = fixture(),
      source = product.presentation.source
    if (source.kind !== 'glb') throw new Error('fixture')
    const gltf = await new GLTFLoader().parseAsync(buffer, '')
    const resources = ownedResources()
    resources.track(gltf.scene)
    const release = vi.fn(() => resources.dispose())
    const geometry = gltf.scene.getObjectByName('Chassis') as Mesh
    const beforeGeometry = geometry.geometry
    const adapter = bindGlb(product, source, gltf.scene, release)
    const knob = adapter.nodes.get('Volume_Dial')!,
      base = knob.quaternion.clone()
    const action = product.presentation.actions[0]!
    adapter.pose[action.id] = 1
    adapter.pose.explosion = 1
    adapter.apply()
    expect(knob.quaternion.equals(base)).toBe(false)
    expect(adapter.nodes.get('Front_Baffle')!.position.z).toBeCloseTo(0.901, 5)
    expect(geometry.geometry).toBe(beforeGeometry)
    expect(adapter.point('Volume_Dial', new Vector3())!.y).toBeCloseTo(2.215, 4)
    for (let i = 0; i < 10; i++) adapter.apply()
    expect(adapter.nodes.get('Front_Baffle')!.position.z).toBeCloseTo(0.901, 5)
    adapter.pose[action.id] = 0
    adapter.pose.explosion = 0
    adapter.apply()
    expect(knob.quaternion.equals(base)).toBe(true)
    const spy = vi.spyOn(beforeGeometry, 'dispose')
    adapter.dispose()
    adapter.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('releases shared and late partial-parse resources exactly once', () => {
    const resources = ownedResources(),
      texture = new Texture(),
      material = new MeshStandardMaterial({ map: texture })
    const geometry = new BoxGeometry(),
      root = new Group()
    root.add(new Mesh(geometry, material), new Mesh(geometry, material))
    const spies = [texture, material, geometry].map((item) => vi.spyOn(item, 'dispose'))
    resources.track(root)
    resources.track(texture)
    resources.dispose()
    resources.dispose()
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
    const late = new MeshStandardMaterial({ map: texture }),
      spy = vi.spyOn(late, 'dispose')
    resources.track(late)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spies[0]).toHaveBeenCalledTimes(1)
  })
  it('runs v3 progress on the real GLB while preserving its geometry and independent dial rotation', async () => {
    const product = fixture(),
      p = product.presentation
    if (p.source.kind !== 'glb' || p.version === 1) throw new Error('fixture')
    p.version = 3
    p.structureActionId = 'layers'
    const tracks = p.source.explode.map((e) => ({
      node: e.node,
      type: 'translate' as const,
      offset: e.offset,
      range: [0, 1] as [number, number],
    }))
    p.source.explode = []
    p.actions.push({
      id: 'layers',
      kind: 'progress',
      label: '可逆分层',
      node: 'Chassis',
      motion: { duration: 2, openLabel: '展开', closeLabel: '合拢', tracks },
    })
    p.hotspots[0]!.anchor = [0, 0, 0.05]
    const validated = parseProduct(product)
    const gltf = await new GLTFLoader().parseAsync(buffer, '')
    const resources = ownedResources()
    resources.track(gltf.scene)
    const release = vi.fn(() => resources.dispose())
    const geometry = (gltf.scene.getObjectByName('Chassis') as Mesh).geometry
    const adapter = bindGlb(validated, p.source, gltf.scene, release)
    const front = adapter.nodes.get('Front_Baffle')!,
      initial = front.position.clone()
    adapter.pose.layers = 0.437
    adapter.pose[p.actions[0]!.id] = 1
    adapter.apply()
    expect(front.position.z - initial.z).toBeCloseTo(
      tracks.find((t) => t.node === 'Front_Baffle')!.offset[2] * 0.437,
      12,
    )
    expect(adapter.nodes.get('Volume_Dial')!.quaternion.equals(new Group().quaternion)).toBe(false)
    expect((gltf.scene.getObjectByName('Chassis') as Mesh).geometry).toBe(geometry)
    adapter.pose.layers = 0
    adapter.apply()
    expect(front.position.equals(initial)).toBe(true)
    adapter.dispose()
    adapter.dispose()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
describe('asynchronous selection', () => {
  it('aborts old loads, disposes late results, suppresses late errors, and preserves current ownership', async () => {
    const slot = new ResourceSlot<{ dispose(): void }>(),
      old = { dispose: vi.fn() },
      current = { dispose: vi.fn() }
    let resolve!: (value: typeof old) => void, oldSignal!: AbortSignal
    const first = slot.load((signal) => {
      oldSignal = signal
      return new Promise((r) => {
        resolve = r
      })
    })
    await slot.load(async () => current)
    expect(oldSignal.aborted).toBe(true)
    resolve(old)
    expect(await first).toBeUndefined()
    expect(old.dispose).toHaveBeenCalledTimes(1)
    expect(current.dispose).not.toHaveBeenCalled()
    slot.clear()
    slot.clear()
    expect(current.dispose).toHaveBeenCalledTimes(1)
    let reject!: (e: Error) => void
    const late = slot.load(
      () =>
        new Promise((_, r) => {
          reject = r
        }),
    )
    slot.clear()
    reject(new Error('late decoder'))
    await expect(late).resolves.toBeUndefined()
    await expect(
      slot.load(async () => {
        throw new Error('current failure')
      }),
    ).rejects.toThrow('current failure')
  })
  it('fetches only checked same-origin files, detects corruption, and honors cancellation', async () => {
    const source = fixture().presentation.source
    if (source.kind !== 'glb') throw new Error('fixture')
    const m = parseBundle(manifest)
    const entry = readFileSync('public/models/bundles/speaker-engineering/v1/model.glb')
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      options.signal?.throwIfAborted()
      return new Response(url.endsWith('.json') ? manifestBytes : entry)
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const result = await loadBundle(source.bundle, new AbortController().signal, vi.fn())
      expect(result.bundle.id).toBe(m.id)
      expect(result.bytes.size).toBe(1)
      expect(await sha256(result.bytes.get(m.entry)!)).toBe(m.files[0]!.sha256)
      expect(fetcher.mock.calls.every(([url]) => url.startsWith('/models/'))).toBe(true)
      fetcher.mockImplementation(async () => new Response('corrupt'))
      await expect(
        loadBundle(source.bundle, new AbortController().signal, vi.fn()),
      ).rejects.toThrow('校验')
      const abort = new AbortController()
      abort.abort()
      await expect(loadBundle(source.bundle, abort.signal, vi.fn())).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
