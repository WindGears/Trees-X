import {
  CompressedTexture,
  Mesh,
  RGBA_BPTC_Format,
  Texture,
  UnsignedByteType,
  type Material,
  type Object3D,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { isCarShadowReceiver } from '../realtime/carShadow/light'
import { getShowroomEnvironment } from './binding'
import { usesBakedFloorReflection } from './floorReflection'
import { createColdStudioProjection } from './projection'
import { usesLocalAreaSpecular } from './receiver'
import { installPaintBevelStudy } from './paintBevelStudy'

function materialProgramKey(object: Mesh, material: MeshStandardNodeMaterial) {
  const slots = new Map<Texture, number>()
  const textures: string[] = []
  for (const [name, texture] of Object.entries(material)) {
    if (!(texture instanceof Texture)) continue
    if (
      Object.getPrototypeOf(texture) !== CompressedTexture.prototype ||
      texture.format !== RGBA_BPTC_Format ||
      texture.type !== UnsignedByteType
    ) {
      textures.push(`${name}:${texture.id}`)
      continue
    }
    // r185 deduplicates texture uniforms by identity. Two properties sharing
    // one packed map must keep the same relationship in a reused program.
    if (!slots.has(texture)) slots.set(texture, slots.size)
    textures.push(
      [
        name,
        'bc7',
        slots.get(texture),
        texture.colorSpace,
        texture.mapping,
        texture.channel,
        texture.internalFormat,
        texture.flipY,
        texture.premultiplyAlpha,
        texture.minFilter,
        texture.magFilter,
        texture.wrapS,
        texture.wrapT,
        texture.anisotropy,
      ].join(':'),
    )
  }
  return [
    isCarShadowReceiver(object, material),
    usesBakedFloorReflection(object),
    usesLocalAreaSpecular(object, material),
    ...textures,
  ].join('/')
}

/** Realtime coordinator owns these material hooks, before adapter resource cleanup. */
export function bindShowroomMaterials(
  scene: Object3D,
  shareProjection?: (material: MeshStandardNodeMaterial) => boolean,
) {
  const binding = getShowroomEnvironment(scene),
    restores: (() => void)[] = [],
    seen = new Set<Material>(),
    projections = new Map<string, ReturnType<typeof createColdStudioProjection>>()
  if (binding)
    restores.push(
      installPaintBevelStudy(
        scene,
        new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get(
          'carBevelStudy',
        ) ?? (binding.config.revision === 18 ? 'finish' : null),
      ),
    )
  if (binding)
    scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof MeshStandardNodeMaterial) || seen.has(material)) continue
        seen.add(material)
        // Architecture and opted-in cabin leather use spatial LTC highlights
        // with the emitter-free probe. Walls stay outside the box projection.
        const texture = usesLocalAreaSpecular(object, material)
          ? binding.irradiance
          : binding.texture
        const projectSpecular = !usesLocalAreaSpecular(object)
        const share =
          binding.config.revision === 18 &&
          Number.isSafeInteger(material.userData.source_vpb_material_id) &&
          shareProjection?.(material)
        const projectionKey = `${texture.id}/${projectSpecular}`
        let install = share ? projections.get(projectionKey) : undefined
        if (!install) {
          install = createColdStudioProjection(
            texture,
            binding.config,
            binding.irradiance,
            projectSpecular,
          )
          if (share) projections.set(projectionKey, install)
        }
        restores.push(
          install(material, share ? () => materialProgramKey(object, material) : undefined),
        )
      }
    })
  return () => {
    for (const restore of restores.reverse()) restore()
  }
}
