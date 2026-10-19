import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Mesh, Texture } from 'three'
import type { AssetBundle } from './assetBundle'
import type { VerifiedFiles } from './assetSession'
import type { WorkbenchRenderer } from './rendering/rendererTypes'

const pools = vi.hoisted(() => ({ active: 0, maximum: 0, created: 0 }))
vi.mock('three/addons/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    constructor() {
      pools.active++
      pools.created++
      pools.maximum = Math.max(pools.maximum, pools.active)
    }
    setTranscoderPath() {
      return this
    }
    setWorkerLimit() {
      return this
    }
    detectSupport() {
      return this
    }
    dispose() {
      pools.active--
    }
  },
}))
import { decodeGlb } from './glbLoader'

class Bitmap {
  width = 4
  height = 4
  close = vi.fn()
}

function fixture(images = 1) {
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    buffers: [{ uri: 'vertex.bin', byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    images: Array.from({ length: images }, (_, i) => ({ uri: `image-${i}.png` })),
    textures: Array.from({ length: images }, (_, source) => ({ source })),
    materials: Array.from({ length: images }, (_, index) => ({
      pbrMetallicRoughness: { baseColorTexture: { index } },
    })),
    meshes: [
      {
        primitives: Array.from({ length: images }, (_, material) => ({
          attributes: { POSITION: 0 },
          material,
        })),
      },
    ],
  }
  const json = new TextEncoder().encode(JSON.stringify(document)),
    padded = Math.ceil(json.length / 4) * 4
  const glb = new ArrayBuffer(20 + padded),
    header = new DataView(glb)
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, glb.byteLength, true)
  header.setUint32(12, padded, true)
  header.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(glb, 20).fill(32)
  new Uint8Array(glb, 20, json.length).set(json)
  const data = new Map<string, ArrayBuffer>([
    ['model.glb', glb],
    ['vertex.bin', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer],
    ...document.images.map(({ uri }) => [uri, new ArrayBuffer(4)] as [string, ArrayBuffer]),
  ])
  const bundle: AssetBundle = {
    schemaVersion: 1,
    id: 'test',
    version: 1,
    entry: 'model.glb',
    files: [...data].map(([path, bytes]) => ({
      path,
      bytes: bytes.byteLength,
      sha256: '0'.repeat(64),
      role: path.endsWith('png') ? 'texture' : 'model',
    })),
    budget: { maxBytes: 100000, maxTriangles: 100 },
    provenance: { author: 'test', source: 'test', license: 'test', redistribution: 'test' },
  }
  const read = vi.fn(async (path: string) => {
    const value = data.get(path)
    if (!value) throw new Error('missing ' + path)
    return value
  })
  const files: VerifiedFiles = { read, release: vi.fn(), dispose: vi.fn() }
  return { bundle, data, files, read }
}
const renderer = {} as WorkbenchRenderer
beforeEach(() => {
  pools.active = 0
  pools.maximum = 0
  pools.created = 0
  vi.stubGlobal('ImageBitmap', Bitmap)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => new Bitmap()),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('streamed GLB dependency ownership', () => {
  it('parses without a package-wide barrier and releases verified containers and images', async () => {
    const f = fixture(3),
      bitmaps: Bitmap[] = []
    let decoding = 0,
      maximum = 0
    const bitmap = vi.fn(async () => {
      decoding++
      maximum = Math.max(maximum, decoding)
      await new Promise((resolve) => setTimeout(resolve, 1))
      const value = new Bitmap()
      bitmaps.push(value)
      decoding--
      return value
    })
    vi.stubGlobal('createImageBitmap', bitmap)
    const result = await decodeGlb(f.bundle, f.files, renderer, new AbortController().signal)
    expect(maximum).toBe(2)
    expect(bitmap).toHaveBeenCalledTimes(3)
    expect(f.files.release).toHaveBeenCalledWith('model.glb')
    expect(f.files.release).toHaveBeenCalledWith('vertex.bin')
    expect(f.files.release).toHaveBeenCalledWith('image-2.png')
    expect(f.read.mock.calls[0]?.[0]).toBe('model.glb')
    expect(f.read.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining(['image-0.png', 'image-1.png', 'image-2.png', 'vertex.bin']),
    )
    expect(bitmap.mock.calls).toHaveLength(3)
    let texture: Texture | undefined
    result.root.traverse((node) => {
      if (node instanceof Mesh && !Array.isArray(node.material) && 'map' in node.material)
        texture = node.material.map as Texture
    })
    expect(texture?.flipY).toBe(false)
    expect(pools.active).toBe(0)
    result.dispose()
    result.dispose()
    expect(bitmaps.every((value) => value.close.mock.calls.length === 1)).toBe(true)
  })
  it('waits for verified bytes before decoding and does not start a newer decoder pool early', async () => {
    const f = fixture(),
      abort = new AbortController()
    let finish!: (value: Bitmap) => void
    const bitmap = vi.fn(
      () =>
        new Promise<Bitmap>((resolve) => {
          finish = resolve
        }),
    )
    vi.stubGlobal('createImageBitmap', bitmap)
    const first = decodeGlb(f.bundle, f.files, renderer, abort.signal)
    const rejection = expect(first).rejects.toThrow()
    await vi.waitFor(() => expect(bitmap).toHaveBeenCalledTimes(1))
    abort.abort()
    const secondFixture = fixture()
    const second = decodeGlb(
      secondFixture.bundle,
      secondFixture.files,
      renderer,
      new AbortController().signal,
    )
    await Promise.resolve()
    expect(pools.created).toBe(1)
    const oldBitmap = new Bitmap()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new Bitmap()),
    )
    finish(oldBitmap)
    await rejection
    const result = await second
    expect(oldBitmap.close).toHaveBeenCalledTimes(1)
    expect(pools.created).toBe(2)
    expect(pools.maximum).toBe(1)
    expect(pools.active).toBe(0)
    result.dispose()
  })
  it('fails instead of silently accepting a missing texture, and releases its reservation', async () => {
    const f = fixture()
    f.data.delete('image-0.png')
    await expect(
      decodeGlb(f.bundle, f.files, renderer, new AbortController().signal),
    ).rejects.toThrow('纹理解析失败')
    expect(f.files.release).toHaveBeenCalledWith('image-0.png')
    expect(pools.active).toBe(0)
  })
})
