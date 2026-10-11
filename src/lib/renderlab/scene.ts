import {
  BufferAttribute,
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  Group,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  Vector3,
  type Material,
  type BufferGeometry,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { getProduct } from '@/lib/workbench/api'
import { loadBundle, sha256 } from '@/lib/workbench/assetBundle'
import { ownedResources } from '@/lib/workbench/ownedResources'
import { bindTypewriterRig, parseTypewriterRig } from '@/lib/workbench/typewriterRig'
import { applyTypewriterFinishes } from '@/lib/workbench/typewriterFinishes'
import { createStudioLights, studioDesign } from '@/lib/workbench/studio/design'
import { labSettings, type LabRequest } from './settings'

/** Prepare the same lab-owned input before either raster or path-tracing setup. */
export async function prepareLabGeometry(input: Iterable<BufferGeometry>) {
  const geometries = [...new Set(input)]
  let indexed = 0,
    normals = 0,
    tangents = 0,
    zeroTangents = 0,
    uvGeometries = 0
  const records = []
  for (const geometry of geometries) {
    const position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv')
    if (!position || position.itemSize !== 3) throw new Error('共享几何缺少三维位置')
    if (uv && (uv.itemSize !== 2 || uv.count !== position.count))
      throw new Error('共享几何 UV 不完整')
    if (uv) uvGeometries++
    if (!geometry.index) {
      const array =
        position.count > 65535 ? new Uint32Array(position.count) : new Uint16Array(position.count)
      for (let i = 0; i < array.length; i++) array[i] = i
      geometry.setIndex(new BufferAttribute(array, 1))
      indexed++
    }
    if (!geometry.getAttribute('normal')) {
      geometry.computeVertexNormals()
      normals++
    }
    if (!geometry.getAttribute('tangent')) {
      if (uv) {
        geometry.computeTangents()
        tangents++
      } else {
        // No UV projection, and no invented tangent direction for anisotropy.
        geometry.setAttribute(
          'tangent',
          new BufferAttribute(new Float32Array(position.count * 4), 4),
        )
        zeroTangents++
      }
    }
    const attributes = []
    for (const name of ['index', ...Object.keys(geometry.attributes).sort()]) {
      const attribute = name === 'index' ? geometry.index! : geometry.getAttribute(name)
      const array = attribute.array
      attributes.push({
        name,
        type: array.constructor.name,
        itemSize: attribute.itemSize,
        count: attribute.count,
        normalized: attribute.normalized,
        stride: 'data' in attribute ? attribute.data.stride : null,
        offset: 'offset' in attribute ? attribute.offset : null,
        bytes: array.byteLength,
        sha256: await sha256(
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice().buffer,
        ),
      })
    }
    records.push({ attributes, groups: geometry.groups, drawRange: geometry.drawRange })
  }
  return {
    version: labSettings.geometryPreparation.version,
    geometries: geometries.length,
    uvGeometries,
    noUvGeometries: geometries.length - uvGeometries,
    created: { indices: indexed, normals, tangents, zeroTangents },
    sha256: await sha256(new TextEncoder().encode(JSON.stringify(records)).buffer),
  }
}

export async function createLabScene(
  request: LabRequest,
  width: number,
  height: number,
  signal: AbortSignal,
) {
  const resources = ownedResources(),
    scene = new Scene(),
    lights = createStudioLights()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    lights.dispose()
    resources.dispose()
    scene.clear()
  }
  try {
    const product = await getProduct(labSettings.product, signal),
      source = product.presentation.source
    if (source.kind !== 'glb' || source.adapter !== 'typewriter-v1')
      throw new Error('验证入口只接受真实打字机资源')
    const { bundle, bytes } = await loadBundle(source.bundle, signal, () => {})
    const entry = bytes.get(bundle.entry)
    if (!entry) throw new Error('打字机 GLB 缺失')
    const loaded = await new GLTFLoader().parseAsync(entry, '')
    resources.track(loaded.scenes)
    signal.throwIfAborted()
    const root = new Group(),
      model = loaded.scene,
      nodes = new Map<string, Object3D>(),
      originals = new Map<Material, MeshStandardMaterial>(),
      finishes = new Set<MeshStandardMaterial>()
    let triangles = 0,
      meshes = 0
    root.name = 'Trees X / renderlab typewriter'
    root.add(model)
    root.position.fromArray(source.transform.position)
    root.rotation.set(...source.transform.rotation)
    root.scale.setScalar(source.transform.scale)
    root.userData.workbenchProduct = product.slug
    model.traverse((node) => {
      if (node.name) {
        if (nodes.has(node.name)) throw new Error('模型节点名称重复：' + node.name)
        nodes.set(node.name, node)
      }
      if (!(node instanceof Mesh)) return
      meshes++
      triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3
      const standard = (material: Material) => {
        if (material instanceof MeshStandardMaterial) return material
        const existing = originals.get(material)
        if (existing) return existing
        if (!(material instanceof MeshBasicMaterial))
          throw new Error('共享 PBR 基线不支持材质：' + material.type)
        const replacement = new MeshStandardMaterial({
          name: material.name,
          color: material.color,
          map: material.map,
          transparent: material.transparent,
          opacity: material.opacity,
          alphaTest: material.alphaTest,
          side: material.side,
          depthWrite: material.depthWrite,
          roughness: 0.72,
          metalness: 0,
        })
        originals.set(material, replacement)
        resources.track(replacement)
        return replacement
      }
      node.material = Array.isArray(node.material)
        ? node.material.map(standard)
        : standard(node.material)
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (material instanceof MeshStandardMaterial) finishes.add(material)
      node.castShadow = true
      node.receiveShadow = true
    })
    applyTypewriterFinishes(finishes, source.transform.scale)
    for (const material of finishes) {
      material.envMapIntensity = 1
      material.aoMap = null
    }
    const program = product.presentation.actions.find((action) => action.motion?.program)?.motion
      ?.program
    const rigBytes = program ? bytes.get(program.file) : undefined
    if (!rigBytes) throw new Error('打字机姿态清单缺失')
    const rig = parseTypewriterRig(JSON.parse(new TextDecoder().decode(rigBytes)) as unknown)
    const pose = {
      'explore-layout': request.view === 'layers' ? 0.6 : request.view === 'flat' ? 1 : 0,
    }
    bindTypewriterRig(rig, nodes, product.presentation)(pose)
    if (rig.length !== 572 || triangles > bundle.budget.maxTriangles)
      throw new Error('实机资源身份或三角面预算不符')
    scene.add(root)
    scene.background = new Color(labSettings.background)
    scene.environmentIntensity = labSettings.environmentIntensity
    scene.add(...lights.lights)

    const pedestal = new Mesh(
      new RoundedBoxGeometry(
        studioDesign.width,
        studioDesign.height,
        studioDesign.depth,
        5,
        studioDesign.radius,
      ),
      new MeshPhysicalMaterial({
        color: studioDesign.pedestal,
        roughness: 0.32,
        metalness: 0.055,
        clearcoat: 0.2,
        clearcoatRoughness: 0.3,
      }),
    )
    pedestal.position.y = studioDesign.groundY - studioDesign.height / 2
    const floor = new Mesh(
      new PlaneGeometry(200, 200),
      new MeshStandardMaterial({ color: studioDesign.floor, roughness: 0.74 }),
    )
    floor.position.y = studioDesign.groundY - studioDesign.height - 0.005
    floor.rotation.x = -Math.PI / 2
    scene.add(pedestal, floor)
    resources.track([pedestal, floor])
    const sharedGeometry = new Set<BufferGeometry>()
    scene.traverse((node) => {
      if (node instanceof Mesh) sharedGeometry.add(node.geometry)
    })
    const geometry = await prepareLabGeometry(sharedGeometry)
    signal.throwIfAborted()

    const hdrResponse = await fetch(labSettings.environment, { signal })
    if (!hdrResponse.ok) throw new Error('共同 HDR 环境不可用')
    const hdrBytes = await hdrResponse.arrayBuffer(),
      hdr = new HDRLoader().setDataType(FloatType).parse(hdrBytes)
    if (!hdr.data || !hdr.width || !hdr.height) throw new Error('HDR 环境解析失败')
    const environment = new DataTexture(hdr.data, hdr.width, hdr.height, RGBAFormat, FloatType)
    environment.colorSpace = LinearSRGBColorSpace
    environment.mapping = EquirectangularReflectionMapping
    environment.minFilter = LinearFilter
    environment.magFilter = LinearFilter
    environment.flipY = true
    environment.needsUpdate = true
    resources.track(environment)
    scene.environment = environment

    const camera = new PerspectiveCamera(
      labSettings.fov,
      width / height,
      labSettings.near,
      labSettings.far,
    )
    camera.zoom = labSettings.zoom
    camera.setViewOffset(
      width,
      height,
      labSettings.viewOffset.x,
      labSettings.viewOffset.y,
      width,
      height,
    )
    const viewId =
        request.view === 'layers' ? 'structure' : request.view === 'flat' ? 'knoll' : 'perspective',
      view = product.presentation.views.find((candidate) => candidate.id === viewId)
    if (!view) throw new Error('共同取景缺失')
    const target = new Vector3().fromArray(view.target)
    camera.position.fromArray(view.position)
    if (request.view === 'paint' || request.view === 'metal') {
      const id = request.view === 'paint' ? labSettings.paintHotspot : labSettings.metalHotspot,
        hotspot = product.presentation.hotspots.find((item) => item.id === id),
        node = hotspot ? nodes.get(hotspot.node) : undefined
      if (!hotspot || !node) throw new Error('共同近景热点缺失')
      root.updateMatrixWorld(true)
      target.fromArray(hotspot.anchor ?? [0, 0, 0])
      node.localToWorld(target)
      camera.position.copy(target).add(new Vector3().fromArray(hotspot.cameraOffset))
    }
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    const poses = rig.map((part) => {
      const node = nodes.get(part.node)!
      return [part.node, ...node.position.toArray(), ...node.quaternion.toArray()]
    })
    const materials = [...finishes]
      .map((material) => ({
        name: material.name,
        type: material.type,
        color: material.color.toArray(),
        roughness: material.roughness,
        metalness: material.metalness,
        envMapIntensity: material.envMapIntensity,
        normalScale: material.normalScale.toArray(),
        clearcoat: material instanceof MeshPhysicalMaterial ? material.clearcoat : null,
        clearcoatRoughness:
          material instanceof MeshPhysicalMaterial ? material.clearcoatRoughness : null,
        anisotropy: material instanceof MeshPhysicalMaterial ? material.anisotropy : null,
        map: material.map?.name ?? null,
        normalMap: material.normalMap?.name ?? null,
        roughnessMap: material.roughnessMap?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const identity = {
      slug: product.slug,
      configuration: await sha256(
        new TextEncoder().encode(JSON.stringify(product.presentation)).buffer,
      ),
      bundle: `${bundle.id}@${bundle.version}`,
      manifest: source.bundle.sha256,
      model: bundle.files.find((file) => file.path === bundle.entry)!.sha256,
      rig: bundle.files.find((file) => file.path === program!.file)!.sha256,
      environment: await sha256(hdrBytes),
      pose: await sha256(new TextEncoder().encode(JSON.stringify(poses)).buffer),
      geometry,
      parts: rig.length,
      meshes,
      batching: 'raw GLB meshes; no production instancing',
      triangles,
    }
    bytes.clear()
    signal.throwIfAborted()
    return { scene, camera, target, identity, materials, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

export type LabScene = Awaited<ReturnType<typeof createLabScene>>
