import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import {
  BoxGeometry,
  CompressedTexture,
  DataTexture,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import { ownedResources } from './ownedResources'
import { prepareReventonSurfaces } from './reventonSurfaceRepair'
import { canonicalizeReventonTextures } from './reventonTextureBindings'

function fixture(textures: Texture[]) {
  for (const texture of textures) if (texture.version === 0) texture.needsUpdate = true
  const model = new Group(),
    geometry = new BoxGeometry(),
    materials = textures.map((map) => new MeshPhysicalMaterial({ map }))
  model.add(...materials.map((material) => new Mesh(geometry, material)))
  return { model, materials }
}

describe('car pre-upload texture bindings', () => {
  it('shares exact source, sampler, UV and role matches, restores source references, and leaves disposal to the loader', () => {
    const original = new Texture({ width: 4096, height: 4096 }),
      clone = original.clone(),
      f = fixture([original, clone]),
      owner = ownedResources()
    owner.track(f.model)
    const binding = canonicalizeReventonTextures(f.model),
      firstDispose = vi.spyOn(original, 'dispose'),
      secondDispose = vi.spyOn(clone, 'dispose')
    expect(binding.before).toBe(2)
    expect(binding.after).toBe(1)
    expect(f.materials[1]!.map).toBe(original)
    binding.dispose()
    binding.dispose()
    expect(f.materials[1]!.map).toBe(clone)
    expect(firstDispose).not.toHaveBeenCalled()
    expect(secondDispose).not.toHaveBeenCalled()
    owner.dispose()
    owner.dispose()
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['UV channel', (value: Texture) => (value.channel = 1)],
    ['colour space', (value: Texture) => (value.colorSpace = SRGBColorSpace)],
    ['wrap', (value: Texture) => (value.wrapS = RepeatWrapping)],
    ['anisotropy', (value: Texture) => (value.anisotropy = 8)],
    ['offset', (value: Texture) => value.offset.set(0.1, 0.2)],
    ['repeat', (value: Texture) => value.repeat.set(2, 3)],
    ['center', (value: Texture) => value.center.set(0.5, 0.5)],
    ['rotation', (value: Texture) => (value.rotation = 0.3)],
    ['matrix', (value: Texture) => value.matrix.setUvTransform(0, 0, 2, 1, 0, 0, 0)],
    ['manual matrix', (value: Texture) => (value.matrixAutoUpdate = false)],
    ['flip', (value: Texture) => (value.flipY = false)],
    ['mip policy', (value: Texture) => (value.generateMipmaps = false)],
    ['premultiply', (value: Texture) => (value.premultiplyAlpha = true)],
    ['alignment', (value: Texture) => (value.unpackAlignment = 1)],
    ['internal format', (value: Texture) => (value.internalFormat = 'RGBA8')],
    ['normalization', (value: Texture) => (value.normalized = true)],
    [
      'mipmap identity',
      (value: Texture) => (value.mipmaps = [{ width: 2, height: 2, data: new Uint8Array(16) }]),
    ],
  ])('does not merge a differing %s', (_label, mutate) => {
    const first = new Texture(),
      second = first.clone()
    mutate(second)
    const f = fixture([first, second]),
      binding = canonicalizeReventonTextures(f.model)
    expect(binding.after).toBe(2)
    expect(f.materials[1]!.map).toBe(second)
    binding.dispose()
  })

  it('does not merge distinct Source identities, even with the same image', () => {
    const image = { width: 16, height: 16 },
      first = new Texture(image),
      second = new Texture(image),
      f = fixture([first, second]),
      binding = canonicalizeReventonTextures(f.model)
    expect(binding.after).toBe(2)
    binding.dispose()
  })

  it('shares exact ordinary compressed clones while preserving distinct mip payload identities and classes', () => {
    const first = new CompressedTexture([{ width: 4, height: 4, data: new Uint8Array(16) }], 4, 4),
      clone = first.clone(),
      differentMip = first.clone(),
      ordinary = new Texture()
    first.needsUpdate = true
    // The source and all sampler values match, but a different mip payload must
    // remain a distinct upload; neither byte equality nor source alone is enough.
    differentMip.mipmaps = [{ width: 4, height: 4, data: new Uint8Array(16) }]
    ordinary.source = first.source
    const f = fixture([first, clone, differentMip, ordinary]),
      binding = canonicalizeReventonTextures(f.model)
    expect(binding.before).toBe(4)
    expect(binding.after).toBe(3)
    expect(f.materials[1]!.map).toBe(first)
    expect(f.materials[2]!.map).toBe(differentMip)
    expect(f.materials[3]!.map).toBe(ordinary)
    binding.dispose()
    expect(f.materials[1]!.map).toBe(clone)
  })

  it('excludes custom texture types, dynamic callbacks, listeners, and unknown differing fields', () => {
    const first = new Texture(),
      data = new DataTexture(),
      callback = first.clone(),
      listener = first.clone(),
      custom = first.clone()
    callback.onUpdate = () => undefined
    listener.addEventListener('dispose', () => undefined)
    Object.assign(custom, { futureSamplingProperty: 2 })
    const f = fixture([first, data, data.clone(), callback, listener, custom]),
      binding = canonicalizeReventonTextures(f.model)
    expect(binding.after).toBe(6)
    binding.dispose()
  })

  it('is idempotent and does not overwrite a later explicit texture change', () => {
    const first = new Texture(),
      clone = first.clone(),
      replacement = new Texture(),
      f = fixture([first, clone]),
      binding = canonicalizeReventonTextures(f.model),
      repeated = canonicalizeReventonTextures(f.model)
    expect(repeated.before).toBe(1)
    expect(repeated.after).toBe(1)
    repeated.dispose()
    f.materials[1]!.map = replacement
    binding.dispose()
    expect(f.materials[1]!.map).toBe(replacement)
  })
})

const carDirectory = 'public/models/reventon',
  carPath = join(carDirectory, 'reventon.glb')

/** CPU only: parse real source material assignments; read PNG dimensions, not pixels. */
it.skipIf(!existsSync(carPath))(
  'counts exact upload identities in the actual original car GLB',
  async () => {
    const loader = new GLTFLoader(),
      owner = ownedResources()
    loader.register((parser) => {
      parser.loadImageSource = async (index) => {
        const image = parser.json.images[index] as { uri: string },
          descriptor = openSync(join(carDirectory, image.uri), 'r'),
          header = Buffer.alloc(24)
        try {
          readSync(descriptor, header, 0, header.length, 0)
        } finally {
          closeSync(descriptor)
        }
        const texture = new Texture({
          width: header.readUInt32BE(16),
          height: header.readUInt32BE(20),
        })
        texture.needsUpdate = true
        return texture
      }
      return { name: 'TREES_CPU_TEXTURE_IDENTITY_ONLY' }
    })
    const bytes = readFileSync(carPath),
      gltf = await loader.parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      ),
      root = gltf.scene
    owner.track(root)
    prepareReventonSurfaces(root)
    const collect = () => {
      const textures = new Set<Texture>()
      root.traverse((node) => {
        if (!(node instanceof Mesh)) return
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          for (const value of Object.values(material))
            if (value instanceof Texture) textures.add(value)
      })
      return textures
    }
    const estimate = (textures: Set<Texture>) =>
      [...textures].reduce((total, texture) => {
        let width = texture.width,
          height = texture.height,
          bytes = 0
        do {
          bytes += width * height * 4
          width = Math.floor(width / 2)
          height = Math.floor(height / 2)
        } while (texture.generateMipmaps && width > 0 && height > 0)
        return total + bytes
      }, 0)
    const before = collect(),
      beforeBytes = estimate(before),
      binding = canonicalizeReventonTextures(root),
      after = collect(),
      afterBytes = estimate(after)
    try {
      expect(binding.before).toBe(before.size)
      expect(binding.after).toBe(after.size)
      expect(before.size).toBe(234)
      expect(after.size).toBe(80)
      expect([...before].filter((texture) => texture.width === 8192)).toHaveLength(41)
      expect([...after].filter((texture) => texture.width === 8192)).toHaveLength(1)
      expect(beforeBytes).toBe(31_943_818_952)
      expect(afterBytes).toBe(7_426_714_176)
      expect(afterBytes).toBeLessThan(beforeBytes)
      expect(
        [...after].every(
          (texture) => texture.colorSpace === NoColorSpace || texture.colorSpace === SRGBColorSpace,
        ),
      ).toBe(true)
      console.info('car CPU upload identity estimate (RGBA8 full mipmaps; not measured VRAM)', {
        before: before.size,
        after: after.size,
        beforeBytes,
        afterBytes,
        before8K: [...before].filter((texture) => texture.width === 8192).length,
        after8K: [...after].filter((texture) => texture.width === 8192).length,
      })
    } finally {
      binding.dispose()
      expect(collect()).toEqual(before)
      owner.dispose()
    }
  },
  30_000,
)
