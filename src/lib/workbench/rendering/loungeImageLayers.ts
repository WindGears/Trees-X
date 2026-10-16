import { DoubleSide, Group, Mesh, PlaneGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { texture, uniform } from 'three/tsl'
import type { LoungeLayerAssets } from './loungeLayerAssets'

// Pixel analysis of the unchanged generated PNGs, with alpha >= 51 / 255.
// Bounds use inclusive top-to-bottom source pixels; no crop rewrites the image.
export const loungeLayerImageBounds = {
  chair: { width: 1536, height: 1024, minX: 101, minY: 143, maxX: 1489, maxY: 938 },
  lamp: { width: 1280, height: 1229, minX: 302, minY: 113, maxX: 976, maxY: 1125 },
} as const

/** Two fixed, parallel image cards. Their original RGB is unlit; the PNGs and
 * their baked illumination are borrowed, never regenerated or relit here.
 */
export function createLoungeImageLayers(
  assets: Pick<LoungeLayerAssets, 'chair' | 'lamp'>,
  floorY: number,
) {
  if (!Number.isFinite(floorY)) throw new Error('分层家具地面高度无效')
  const group = new Group(),
    blend = uniform(0),
    chairBounds = loungeLayerImageBounds.chair,
    lampBounds = loungeLayerImageBounds.lamp,
    chairWidth = 6,
    chairHeight = 4,
    chairX = -1,
    chairY = floorY + chairHeight * ((chairBounds.maxY + 1) / chairBounds.height - 0.5),
    planeZ = -9,
    // Hand-placed center of the pictured tabletop, in unchanged source pixels.
    // This is image composition calibration, not recovered 3D geometry.
    tablePixelX = 1285.5,
    tablePixelY = 382.5,
    tableX = chairX + chairWidth * (tablePixelX / chairBounds.width - 0.5),
    tableY = chairY + chairHeight * (0.5 - tablePixelY / chairBounds.height),
    lampHeight = 2,
    lampWidth = lampHeight * (lampBounds.width / lampBounds.height),
    lampOpaqueCenterX = (lampBounds.minX + lampBounds.maxX + 1) / 2,
    lampX = tableX - lampWidth * (lampOpaqueCenterX / lampBounds.width - 0.5),
    lampY = tableY + lampHeight * ((lampBounds.maxY + 1) / lampBounds.height - 0.5),
    // Parallel to the chair card, slightly in front to avoid coplanar depth ties.
    lampZ = planeZ + 0.02,
    chairGeometry = new PlaneGeometry(chairWidth, chairHeight),
    lampGeometry = new PlaneGeometry(lampWidth, lampHeight)

  const material = (image: LoungeLayerAssets['chair'], name: string) => {
    const result = new MeshBasicNodeMaterial({
        side: DoubleSide,
        alphaTest: 0.2,
        transparent: false,
        depthWrite: true,
        depthTest: true,
        toneMapped: false,
        fog: false,
      }),
      sample = texture(image)
    result.name = name
    result.colorNode = sample.rgb.mul(blend)
    result.opacityNode = sample.a
    return result
  }
  const chairMaterial = material(assets.chair, 'Trees X / unlit chair and table image'),
    lampMaterial = material(assets.lamp, 'Trees X / unlit lamp image'),
    chair = new Mesh(chairGeometry, chairMaterial),
    lamp = new Mesh(lampGeometry, lampMaterial),
    metadata = {
      kind: 'image-layers' as const,
      cardCount: 2,
      floorY,
      alphaTest: 0.2,
      sourceBounds: loungeLayerImageBounds,
      anchors: {
        tabletop: [tableX, tableY, planeZ] as const,
        lampBase: [tableX, tableY, lampZ] as const,
        // Approximate center inside the shade; suitable for a separate owned light.
        lampEmitter: [
          tableX,
          lampY + lampHeight * (0.5 - 375.5 / lampBounds.height),
          lampZ,
        ] as const,
      },
      limitations: [
        'Fixed image cards have zero thickness and no automatic billboard rotation; oblique views flatten and rear views mirror the source.',
        'Source RGB already contains illumination and shadows; these cards do not respond to scene lighting or reconstruct hidden furniture geometry.',
        'Tabletop and lamp anchors are manual image composition calibration, not measured 3D coordinates.',
      ],
    }
  group.name = 'Trees X / experimental lounge image layers'
  group.userData.loungeImageLayers = metadata
  chair.name = 'Trees X / chair and side table image card'
  lamp.name = 'Trees X / table lamp image card'
  chair.userData.traceExclude = lamp.userData.traceExclude = true
  chair.position.set(chairX, chairY, planeZ)
  lamp.position.set(lampX, lampY, lampZ)
  group.add(chair, lamp)
  group.visible = false
  let disposed = false
  return {
    group,
    metadata,
    setBlend(value: number) {
      if (disposed) return
      const amount = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
      blend.value = amount
      group.visible = amount > 0
    },
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      chairGeometry.dispose()
      lampGeometry.dispose()
      chairMaterial.dispose()
      lampMaterial.dispose()
      // Texture/ImageBitmap ownership stays with loadLoungeLayerAssets.
    },
  }
}
