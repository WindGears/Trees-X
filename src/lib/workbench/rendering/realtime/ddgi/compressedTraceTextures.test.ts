import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  CompressedTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Source,
  Texture,
} from 'three'
import type { VerifiedFiles } from '../../../assetSession'
import {
  prepareCompressedTraceTextures,
  resolveCompressedTraceTexture,
} from './compressedTraceTextures'

class TraceBitmap {
  close = vi.fn()
  constructor(
    readonly width = 256,
    readonly height = 128,
  ) {}
}
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture() {
  const root = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshStandardMaterial(),
    texture = new CompressedTexture([], 4096, 2048),
    bitmap = new TraceBitmap(),
    decode = vi.fn().mockResolvedValue(bitmap),
    files: VerifiedFiles = {
      read: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      release: vi.fn(),
      dispose: vi.fn(),
    },
    abort = new AbortController()
  texture.userData.treesTraceImage = 'trace/texture-000.png'
  material.map = texture
  root.add(new Mesh(geometry, material))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('ImageBitmap', TraceBitmap)
  cleanups.push(() => {
    geometry.dispose()
    material.dispose()
    texture.dispose()
  })
  return { root, material, texture, bitmap, decode, files, abort }
}

describe('compressed GPU textures with separately owned CPU tracing views', () => {
  it('shares one CPU Source across texture clones while preserving each UV and colour configuration', async () => {
    const f = fixture(),
      clone = f.texture.clone()
    clone.repeat.set(2, 3)
    clone.offset.set(0.1, 0.2)
    clone.center.set(0.5, 0.5)
    clone.rotation = 0.4
    clone.channel = 1
    clone.wrapS = RepeatWrapping
    clone.flipY = true
    clone.colorSpace = NoColorSpace
    clone.updateMatrix()
    f.texture.colorSpace = SRGBColorSpace
    f.material.normalMap = clone
    const source = f.texture.source,
      sourceVersion = source.version,
      sourceImage = source.data,
      sourceDispose = vi.spyOn(f.texture, 'dispose'),
      owner = await prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)
    cleanups.push(owner.dispose, () => clone.dispose())
    const first = resolveCompressedTraceTexture(f.texture),
      second = resolveCompressedTraceTexture(clone),
      firstDispose = vi.spyOn(first, 'dispose'),
      secondDispose = vi.spyOn(second, 'dispose')
    expect(first).toBeInstanceOf(Texture)
    expect(first).not.toBeInstanceOf(CompressedTexture)
    expect(Reflect.get(first, 'isCompressedTexture')).toBeUndefined()
    expect(first.source).toBeInstanceOf(Source)
    expect(first.source).toBe(second.source)
    expect(first.source).not.toBe(source)
    expect(first.image).toBe(f.bitmap)
    expect(first.colorSpace).toBe(SRGBColorSpace)
    expect(first.flipY).toBe(false)
    expect(second).not.toBe(first)
    expect(second.repeat.equals(clone.repeat)).toBe(true)
    expect(second.repeat).not.toBe(clone.repeat)
    expect(second.offset.equals(clone.offset)).toBe(true)
    expect(second.center.equals(clone.center)).toBe(true)
    expect(second.matrix.equals(clone.matrix)).toBe(true)
    expect(second).toMatchObject({
      rotation: 0.4,
      channel: 1,
      wrapS: RepeatWrapping,
      flipY: true,
      colorSpace: NoColorSpace,
      version: 0,
      mipmaps: [],
    })
    expect(f.texture.source).toBe(source)
    expect(source.data).toBe(sourceImage)
    expect(source.version).toBe(sourceVersion)
    expect(f.material.map).toBe(f.texture)
    expect(f.material.normalMap).toBe(clone)
    expect(f.decode).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    expect(f.files.read).toHaveBeenCalledExactlyOnceWith('trace/texture-000.png')
    expect(f.files.release).toHaveBeenCalledExactlyOnceWith('trace/texture-000.png')
    owner.dispose()
    owner.dispose()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(sourceDispose).not.toHaveBeenCalled()
    expect(f.files.dispose).not.toHaveBeenCalled()
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
  })

  it('resolves later clones by original Source and keeps sampling edits local', async () => {
    const f = fixture(),
      owner = await prepareCompressedTraceTextures(f.root, f.files, f.abort.signal),
      clone = f.texture.clone()
    cleanups.push(owner.dispose, () => clone.dispose())
    clone.offset.set(0.3, 0.6)
    const view = resolveCompressedTraceTexture(clone)
    expect(view.image).toBe(f.bitmap)
    expect(view.offset.equals(clone.offset)).toBe(true)
    clone.repeat.set(4, 5)
    expect(resolveCompressedTraceTexture(clone)).toBe(view)
    expect(view.repeat.equals(clone.repeat)).toBe(true)
    const ordinary = new Texture()
    cleanups.push(() => ordinary.dispose())
    expect(resolveCompressedTraceTexture(ordinary)).toBe(ordinary)
    expect(resolveCompressedTraceTexture(null)).toBeNull()
    expect(resolveCompressedTraceTexture(undefined)).toBeUndefined()
  })

  it('rejects missing and conflicting metadata without changing any source material', async () => {
    const f = fixture()
    delete f.texture.userData.treesTraceImage
    await expect(prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)).rejects.toThrow(
      '缺少有效',
    )
    expect(f.files.read).not.toHaveBeenCalled()
    expect(f.material.map).toBe(f.texture)
    f.texture.userData.treesTraceImage = 'trace/texture-000.png'
    const clone = f.texture.clone()
    cleanups.push(() => clone.dispose())
    clone.userData.treesTraceImage = 'trace/texture-001.png'
    f.material.normalMap = clone
    await expect(prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)).rejects.toThrow(
      '不同的 CPU',
    )
    expect(f.files.read).not.toHaveBeenCalled()
  })

  it('reads exclusively through verified files and releases failed package reads', async () => {
    const f = fixture()
    vi.mocked(f.files.read).mockRejectedValue(new Error('模型请求了包外资源'))
    await expect(prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)).rejects.toThrow(
      '包外资源',
    )
    expect(f.files.release).toHaveBeenCalledExactlyOnceWith('trace/texture-000.png')
    expect(f.decode).not.toHaveBeenCalled()
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
  })

  it('closes earlier and invalid-size images after a later decode fails validation', async () => {
    const f = fixture(),
      second = new CompressedTexture([], 4096, 2048),
      invalid = new TraceBitmap(257, 128)
    second.userData.treesTraceImage = 'trace/texture-001.png'
    f.material.normalMap = second
    cleanups.push(() => second.dispose())
    f.decode.mockResolvedValueOnce(f.bitmap).mockResolvedValueOnce(invalid)
    await expect(prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)).rejects.toThrow(
      '1–256',
    )
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(invalid.close).toHaveBeenCalledOnce()
    expect(f.files.release).toHaveBeenCalledTimes(2)
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
  })

  it('closes earlier images when a subsequent registered PNG cannot decode', async () => {
    const f = fixture(),
      second = new CompressedTexture([], 4096, 2048)
    second.userData.treesTraceImage = 'trace/texture-001.png'
    f.material.normalMap = second
    cleanups.push(() => second.dispose())
    f.decode.mockResolvedValueOnce(f.bitmap).mockRejectedValueOnce(new Error('PNG decode failed'))
    await expect(prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)).rejects.toThrow(
      'PNG decode failed',
    )
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(f.files.release).toHaveBeenCalledTimes(2)
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
  })

  it('rejects before any decode when cancellation wins a pending verified read', async () => {
    const f = fixture(),
      complete: { read?: (bytes: ArrayBuffer) => void } = {}
    vi.mocked(f.files.read).mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          complete.read = resolve
        }),
    )
    const pending = prepareCompressedTraceTextures(f.root, f.files, f.abort.signal),
      rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    f.abort.abort()
    complete.read!(new ArrayBuffer(8))
    await rejected
    expect(f.decode).not.toHaveBeenCalled()
    expect(f.files.release).toHaveBeenCalledOnce()
    await expect(
      prepareCompressedTraceTextures(f.root, f.files, f.abort.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(f.files.read).toHaveBeenCalledOnce()
  })

  it('closes an already decoded image on abort and closes a late bitmap exactly once', async () => {
    const f = fixture(),
      second = new CompressedTexture([], 4096, 2048),
      late = new TraceBitmap(),
      complete: { decode?: (bitmap: TraceBitmap) => void } = {}
    second.userData.treesTraceImage = 'trace/texture-001.png'
    f.material.normalMap = second
    cleanups.push(() => second.dispose())
    f.decode.mockResolvedValueOnce(f.bitmap).mockImplementationOnce(
      () =>
        new Promise<TraceBitmap>((resolve) => {
          complete.decode = resolve
        }),
    )
    const pending = prepareCompressedTraceTextures(f.root, f.files, f.abort.signal),
      rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.decode).toHaveBeenCalledTimes(2))
    f.abort.abort()
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    complete.decode!(late)
    await rejected
    expect(late.close).toHaveBeenCalledOnce()
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(f.files.release).toHaveBeenCalledTimes(2)
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
  })

  it('retains transferred images after session disposal until the resource owner disposes', async () => {
    const f = fixture()
    vi.mocked(f.files.dispose).mockImplementation(() => f.abort.abort())
    const owner = await prepareCompressedTraceTextures(f.root, f.files, f.abort.signal)
    cleanups.push(owner.dispose)
    f.files.dispose()
    expect(f.abort.signal.aborted).toBe(true)
    expect(f.bitmap.close).not.toHaveBeenCalled()
    const view = resolveCompressedTraceTexture(f.texture),
      release = vi.spyOn(view, 'dispose'),
      clone = f.texture.clone()
    cleanups.push(() => clone.dispose())
    expect(view.image).toBe(f.bitmap)
    expect(resolveCompressedTraceTexture(clone).source).toBe(view.source)
    expect(f.files.read).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    owner.dispose()
    owner.dispose()
    expect(release).toHaveBeenCalledOnce()
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
    expect(() => resolveCompressedTraceTexture(clone)).toThrow('缺少已登记')
  })

  it('keeps a returned owner live after cancellation and allows replacement after manual disposal', async () => {
    const f = fixture(),
      owner = await prepareCompressedTraceTextures(f.root, f.files, f.abort.signal),
      view = resolveCompressedTraceTexture(f.texture),
      release = vi.spyOn(view, 'dispose')
    f.abort.abort()
    expect(resolveCompressedTraceTexture(f.texture)).toBe(view)
    expect(release).not.toHaveBeenCalled()
    expect(f.bitmap.close).not.toHaveBeenCalled()
    owner.dispose()
    expect(release).toHaveBeenCalledOnce()
    expect(f.bitmap.close).toHaveBeenCalledOnce()
    expect(() => resolveCompressedTraceTexture(f.texture)).toThrow('缺少已登记')
    const next = new TraceBitmap()
    f.decode.mockResolvedValue(next)
    const nextOwner = await prepareCompressedTraceTextures(
      f.root,
      f.files,
      new AbortController().signal,
    )
    cleanups.push(nextOwner.dispose)
    expect(resolveCompressedTraceTexture(f.texture).image).toBe(next)
  })
})
