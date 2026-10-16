import { Mesh, type Texture } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { color, mix, uniform } from 'three/tsl'
import type { createGpuStudioGeometry } from './studioGeometry'
import { loadLoungeDepth } from './loungeDepth'
import { loadLoungeCleanRoom } from './loungeLayerAssets'
import { createDepthLoungeProjection, createFiniteLoungeProjection } from './loungeSpatialGeometry'
import { resolveLoungeProjection } from './loungeSpatialMode'

/** Owns the derived room/clean plate; the source panorama and studio are borrowed. */
export async function createLoungeSpatialLook(
  studio: ReturnType<typeof createGpuStudioGeometry>,
  image: Texture,
  signal: AbortSignal,
) {
  const mode = resolveLoungeProjection()
  if (mode === 'infinite' || !studio.table) return undefined
  const cleanRoomRequested =
      mode === 'box' && new URLSearchParams(window.location.search).get('loungeLayers') === '1',
    floorY = studio.table.floorY,
    origin = [0, 1.4, 0] as const,
    scale = (origin[1] - floorY) / 0.1165,
    bounds = { min: [-42, floorY, -42] as const, max: [42, 18, 42] as const },
    calibration = {
      origin,
      scale,
      minRadius: 0.1,
      maxRadius: 80,
      maxDepthRatio: 1.35,
      longitudeOffset: 0.08,
    }
  let roomAssets: Awaited<ReturnType<typeof loadLoungeCleanRoom>> | undefined,
    projection:
      | ReturnType<typeof createDepthLoungeProjection>
      | ReturnType<typeof createFiniteLoungeProjection>
      | undefined
  try {
    signal.throwIfAborted()
    // Keep existing URLs, but no longer load or create the flat furniture cards.
    if (cleanRoomRequested) roomAssets = await loadLoungeCleanRoom(signal)
    const source = mode === 'depth' ? await loadLoungeDepth(signal) : undefined
    signal.throwIfAborted()
    projection = source
      ? createDepthLoungeProjection(image, {
          depth: source.distance,
          width: source.width,
          height: source.height,
          segments: { longitude: source.width, latitude: source.height - 1 },
          calibration,
          fallbackBounds: bounds,
        })
      : createFiniteLoungeProjection(roomAssets?.cleanRoom ?? image, {
          ...bounds,
          captureOrigin: origin,
          longitudeOffset: calibration.longitudeOffset,
        })
    // Fit the predicted floor to the real table's bottom; hidden geometry stays unknown.
    let groundedVertices = 0
    if (source) {
      const position = projection.mesh.geometry.getAttribute('position')
      for (let index = 0; index < position.count; index++) {
        const y = position.getY(index)
        if (Math.abs(y - floorY) < 0.5) {
          position.setY(index, floorY)
          groundedVertices++
        }
      }
      position.needsUpdate = true
      projection.mesh.geometry.computeVertexNormals()
      projection.mesh.geometry.computeBoundingBox()
      projection.mesh.geometry.computeBoundingSphere()
    }
    const blend = uniform(1)
    projection.group.traverse((node) => {
      if (node instanceof Mesh && node.material instanceof MeshBasicNodeMaterial) {
        const material = node.material
        if (material.colorNode)
          material.colorNode = mix(color('#e7e9e5'), material.colorNode as Node<'vec3'>, blend)
      }
    })
    const metadata = {
      mode,
      status: 'ready',
      calibration,
      floorY,
      groundedVertices,
      fallback: source ? 'unrecovered-far-box' : null,
      stats: 'stats' in projection ? projection.stats : null,
      imageLayers: null,
      cleanPlate: roomAssets ? '/studio/amber-lounge/layers-v1/clean-room.png' : null,
    }
    projection.group.userData.loungeSpatial = metadata
    studio.group.userData.loungeSpatial = metadata
    studio.group.add(projection.group)
    const ownedProjection = projection,
      ownedAssets = roomAssets,
      originalSky = studio.sky.visible,
      originalFloor = studio.floorMesh.visible
    let disposed = false
    return {
      setBlend(value: number) {
        if (disposed) return
        const amount = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0,
          visible = amount > 0.001
        blend.value = amount
        ownedProjection.group.visible = visible
        studio.sky.visible = visible ? false : originalSky
        studio.floorMesh.visible = visible ? false : originalFloor
      },
      dispose() {
        if (disposed) return
        disposed = true
        ownedProjection.dispose()
        ownedAssets?.dispose()
        studio.sky.visible = originalSky
        studio.floorMesh.visible = originalFloor
        if (studio.group.userData.loungeSpatial === metadata)
          delete studio.group.userData.loungeSpatial
      },
    }
  } catch (cause) {
    projection?.dispose()
    roomAssets?.dispose()
    throw cause
  }
}
