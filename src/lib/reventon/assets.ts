import { LoadingManager, Mesh, Texture } from 'three'
import type { DataTexture, Group, Material, MeshPhysicalMaterial } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { disposeModel } from '@/lib/three/model'
import { parseMotion } from './motion'
import type { ReventonMotion } from './motion'
import { prepareReventonMaterials } from './materials'

export interface ReventonAssets {
  model: Group
  environment: DataTexture
  motion: ReventonMotion
  meshes: number
  triangles: number
  release: () => void
}

export async function loadReventon(signal: AbortSignal): Promise<ReventonAssets> {
  signal.throwIfAborted()
  const base = `${import.meta.env.BASE_URL}models/reventon/`
  const manager = new LoadingManager()
  let resourceFailed = false
  manager.onError = () => {
    resourceFailed = true
  }
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url
    const resolved = new URL(url, window.location.href)
    if (resolved.origin !== window.location.origin) throw new Error('展品资源必须来自本站。')
    return resolved.href
  })
  const abort = () => manager.abort()
  signal.addEventListener('abort', abort, { once: true })
  const results = await Promise.allSettled([
    new GLTFLoader(manager).loadAsync(`${base}reventon.glb`),
    new EXRLoader(manager).loadAsync(`${base}studio.exr`),
    fetch(`${base}motion.json`, { signal }).then(async (response) => {
      if (!response.ok) throw new Error('演示动作暂时无法读取。')
      return parseMotion(await response.json())
    }),
  ])
  signal.removeEventListener('abort', abort)
  const [modelResult, environmentResult, motionResult] = results
  if (
    signal.aborted ||
    resourceFailed ||
    modelResult.status !== 'fulfilled' ||
    environmentResult.status !== 'fulfilled' ||
    motionResult.status !== 'fulfilled'
  ) {
    if (modelResult.status === 'fulfilled') disposeModel(modelResult.value.scene)
    if (environmentResult.status === 'fulfilled') environmentResult.value.dispose()
    signal.throwIfAborted()
    throw new Error('车身、材质或演示资源加载失败，请重试。')
  }
  const model = modelResult.value.scene
  const environment = environmentResult.value
  let disposed = false
  const release = () => {
    if (disposed) return
    disposed = true
    disposeModel(model)
    environment.dispose()
  }
  let meshes = 0
  let triangles = 0
  let sourceObjects = 0
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3
    const count: unknown = object.userData.source_object_count
    if (typeof count === 'number') sourceObjects += count
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material]
    object.castShadow = !materials.some((m) => (m as MeshPhysicalMaterial).transmission > 0)
    object.receiveShadow = true
  })
  // Blender validates away 207 exact duplicate faces, verified against original
  // vertex-index triples in duplicate-face-audit.json. No surface was decimated.
  if (triangles !== 1_500_363 || sourceObjects !== 2998) {
    release()
    throw new Error('模型完整性检查未通过，未显示不完整的展品。')
  }
  prepareReventonMaterials(model)
  return { model, environment, motion: motionResult.value, meshes, triangles, release }
}

export function setTextureQuality(root: Group, anisotropy: number) {
  const visited = new Set<Texture>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials)
      for (const value of Object.values(material)) {
        if (!(value instanceof Texture) || visited.has(value)) continue
        visited.add(value)
        value.anisotropy = anisotropy
        value.needsUpdate = true
      }
  })
}
