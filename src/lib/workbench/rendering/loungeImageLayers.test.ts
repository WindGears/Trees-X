import { Group, Mesh, Texture, Vector3 } from 'three'
import { fileURLToPath } from 'node:url'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoungeImageLayers, loungeLayerImageBounds } from './loungeImageLayers'

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const chair = new Texture(),
    lamp = new Texture(),
    floorY = -2.48,
    layers = createLoungeImageLayers({ chair, lamp }, floorY),
    cards = layers.group.children.filter((child): child is Mesh => child instanceof Mesh)
  return { chair, lamp, floorY, layers, cards }
}

function borrowedTextures(node: Node | null) {
  const values = new Set<Texture>()
  node?.traverse((child) => {
    if ('value' in child && child.value instanceof Texture) values.add(child.value)
  })
  return values
}

describe('fixed image furniture experiment', () => {
  it('keeps actual alpha-tested furniture cards unlit and parallel without a billboard loop', () => {
    const f = fixture()
    expect(f.layers.metadata).toMatchObject({ kind: 'image-layers', cardCount: 2, alphaTest: 0.2 })
    expect(f.layers.metadata.limitations.join(' ')).toContain('oblique')
    expect(f.cards).toHaveLength(2)
    expect(f.layers.group.visible).toBe(false)
    for (const [index, card] of f.cards.entries()) {
      expect(card.material).toBeInstanceOf(MeshBasicNodeMaterial)
      if (!(card.material instanceof MeshBasicNodeMaterial))
        throw new Error('Unexpected layer material')
      expect(card.material.alphaTest).toBe(0.2)
      expect(card.material.transparent).toBe(false)
      expect(card.material.depthWrite).toBe(true)
      expect(card.material.depthTest).toBe(true)
      expect(card.material.toneMapped).toBe(false)
      expect(card.material.fog).toBe(false)
      expect(borrowedTextures(card.material.colorNode)).toEqual(
        new Set([index === 0 ? f.chair : f.lamp]),
      )
      expect(borrowedTextures(card.material.opacityNode)).toEqual(
        new Set([index === 0 ? f.chair : f.lamp]),
      )
      expect(card.quaternion.equals(f.cards[0]!.quaternion)).toBe(true)
      expect(card.castShadow || card.receiveShadow).toBe(false)
    }
    expect(f.cards[1]!.position.z - f.cards[0]!.position.z).toBeCloseTo(0.02)
    f.layers.dispose()
    f.chair.dispose()
    f.lamp.dispose()
  })

  it('grounds visible chair feet and places the visible lamp base on the pictured tabletop', () => {
    const f = fixture(),
      chair = f.cards[0]!,
      lamp = f.cards[1]!,
      chairBox = loungeLayerImageBounds.chair,
      lampBox = loungeLayerImageBounds.lamp,
      chairFeet = new Vector3(0, 4 * (0.5 - (chairBox.maxY + 1) / chairBox.height), 0),
      lampBase = new Vector3(
        ((2 * lampBox.width) / lampBox.height) *
          ((lampBox.minX + lampBox.maxX + 1) / 2 / lampBox.width - 0.5),
        2 * (0.5 - (lampBox.maxY + 1) / lampBox.height),
        0,
      )
    f.layers.group.updateMatrixWorld(true)
    chair.localToWorld(chairFeet)
    lamp.localToWorld(lampBase)
    expect(chairFeet.y).toBeCloseTo(f.floorY, 8)
    expect(lampBase.toArray()).toEqual(f.layers.metadata.anchors.lampBase)
    expect(lampBase.y).toBeCloseTo(f.layers.metadata.anchors.tabletop[1], 8)
    expect(lampBase.y - f.floorY).toBeCloseTo(2.173828125, 8)
    expect(f.layers.metadata.anchors.lampEmitter[1]).toBeGreaterThan(lampBase.y)
    f.layers.dispose()
    f.chair.dispose()
    f.lamp.dispose()
  })

  it('changes uniform brightness and visibility without moving the fixed cards', () => {
    const f = fixture()
    f.layers.group.updateMatrixWorld(true)
    const matrices = f.cards.map((card) => card.matrix.clone())
    for (const blend of [0.3, 1, 0.7]) {
      f.layers.setBlend(blend)
      expect(f.layers.group.visible).toBe(true)
    }
    f.layers.group.updateMatrixWorld(true)
    for (const [index, card] of f.cards.entries()) {
      expect(card.matrix.equals(matrices[index]!)).toBe(true)
      if (!(card.material instanceof MeshBasicNodeMaterial)) throw new Error('Unexpected material')
      const uniforms: number[] = []
      card.material.colorNode?.traverse((node) => {
        if (node.type === 'UniformNode' && 'value' in node && typeof node.value === 'number')
          uniforms.push(node.value)
      })
      expect(uniforms).toContain(0.7)
    }
    f.layers.setBlend(-1)
    expect(f.layers.group.visible).toBe(false)
    f.layers.setBlend(Number.NaN)
    expect(f.layers.group.visible).toBe(false)
    f.layers.dispose()
    f.chair.dispose()
    f.lamp.dispose()
  })

  it('releases only its geometry and materials exactly once and detaches from its host', () => {
    const f = fixture(),
      host = new Group(),
      releases = f.cards.flatMap((card) => {
        if (Array.isArray(card.material)) throw new Error('Unexpected multi-material card')
        return [vi.spyOn(card.geometry, 'dispose'), vi.spyOn(card.material, 'dispose')]
      }),
      borrowed = [vi.spyOn(f.chair, 'dispose'), vi.spyOn(f.lamp, 'dispose')]
    host.add(f.layers.group)
    f.layers.dispose()
    f.layers.dispose()
    f.layers.setBlend(1)
    expect(host.children).toHaveLength(0)
    expect(f.layers.group.children).toHaveLength(0)
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
    for (const release of borrowed) expect(release).not.toHaveBeenCalled()
    f.chair.dispose()
    f.lamp.dispose()
    expect(() => createLoungeImageLayers({ chair: f.chair, lamp: f.lamp }, Infinity)).toThrow(
      '高度无效',
    )
  })

  it('matches the actual unchanged PNG alpha extents used for floor and tabletop calibration', async () => {
    for (const [key, filename] of [
      ['chair', 'chair-table.png'],
      ['lamp', 'table-lamp.png'],
    ] as const) {
      const path = new URL(
          '../../../../public/studio/amber-lounge/layers-v1/' + filename,
          import.meta.url,
        ),
        image = await sharp(fileURLToPath(path))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
      let minX = image.info.width,
        minY = image.info.height,
        maxX = -1,
        maxY = -1,
        transparent = 0
      for (let y = 0; y < image.info.height; y++)
        for (let x = 0; x < image.info.width; x++) {
          const alpha = image.data[(y * image.info.width + x) * 4 + 3]!
          if (alpha === 0) transparent++
          if (alpha < 51) continue
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      expect(transparent).toBeGreaterThan(0)
      expect({
        width: image.info.width,
        height: image.info.height,
        minX,
        minY,
        maxX,
        maxY,
      }).toEqual(loungeLayerImageBounds[key])
    }
  })
})
