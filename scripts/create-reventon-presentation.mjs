import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { Box3, Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three'
import { format, resolveConfig } from 'prettier'
import { digest, jsonText, relativeResource } from './asset-package.mjs'

// Reuse the immutable runtime files in place. This tool never exports, copies or rewrites them.
const directory = resolve('public/models/reventon')
const provenance = JSON.parse(await readFile(resolve(directory, 'provenance.json'), 'utf8'))
const motionBytes = await readFile(resolve(directory, 'motion.json'))
const motion = JSON.parse(motionBytes.toString('utf8'))
const source = await open(resolve(directory, 'reventon.glb'), 'r')
let glb
try {
  const header = Buffer.alloc(20)
  if ((await source.read(header, 0, 20, 0)).bytesRead !== 20)
    throw new Error('Truncated GLB header')
  if (
    header.readUInt32LE(0) !== 0x46546c67 ||
    header.readUInt32LE(4) !== 2 ||
    header.readUInt32LE(16) !== 0x4e4f534a
  )
    throw new Error('Expected the existing GLB 2.0 asset')
  const json = Buffer.alloc(header.readUInt32LE(12))
  if ((await source.read(json, 0, json.length, 20)).bytesRead !== json.length)
    throw new Error('Truncated GLB JSON chunk')
  glb = JSON.parse(json.toString('utf8'))
} finally {
  await source.close()
}
if (
  motion.fps !== 24 ||
  motion.frames !== 384 ||
  motion.tracks.length !== 7 ||
  provenance.triangles !== 1_500_363 ||
  glb.meshes.length !== 135 ||
  glb.images.length !== 75
)
  throw new Error('Source profile does not match the verified Reventon runtime asset')

const recorded = new Map([...provenance.files, ...provenance.resources].map((f) => [f.file, f]))
if (
  motionBytes.length !== recorded.get('motion.json')?.bytes ||
  digest(motionBytes) !== recorded.get('motion.json')?.sha256
)
  throw new Error('The authored motion source changed; do not regenerate from unverified data')
async function fileRecord(path, role) {
  relativeResource(path)
  const record = recorded.get(path)
  if (!record) throw new Error('Missing original provenance entry: ' + path)
  const file = resolve(directory, path),
    size = (await stat(file)).size
  if (size !== record.bytes) throw new Error('Original resource size changed: ' + path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== record.sha256) throw new Error('Original resource changed: ' + path)
  return { path, bytes: size, sha256: record.sha256, role }
}
const images = glb.images.map((image) => relativeResource(image.uri))
if (new Set(images).size !== 75) throw new Error('Expected 75 unique external PNG dependencies')
const files = [await fileRecord('reventon.glb', 'model')]
for (const path of images) files.push(await fileRecord(path, 'texture'))
files.push(await fileRecord('studio.exr', 'environment'))
const manifest = {
  schemaVersion: 1,
  id: 'reventon-workbench',
  version: 1,
  entry: 'reventon.glb',
  files,
  budget: { maxBytes: files.reduce((sum, file) => sum + file.bytes, 0), maxTriangles: 1_500_363 },
  provenance: {
    author: 'Original model author not supplied; runtime recovery documented by Trees X',
    source: provenance.source,
    license: 'No redistribution license supplied with the user-provided VPB source',
    redistribution: 'Local academic demonstration; no new redistribution permission is asserted',
  },
  profile: {
    meshes: 135,
    materials: 135,
    triangles: 1_500_363,
    textures: 75,
    sourceObjects: 2998,
    motionGroups: 7,
    behavior: 'Configured rigid assembly observation; not automatic mechanical disassembly',
    motionSource: {
      file: 'motion.json',
      sha256: recorded.get('motion.json').sha256,
      sampledFrames: [0, 80, 263],
      requestedAtRuntime: false,
    },
  },
}
const manifestText = await jsonText(manifest)

const nodeIndices = new Map(glb.nodes.map((node, index) => [node.name, index]))
const rigIndices = new Map(
  glb.nodes.flatMap((node, index) =>
    node.extras?.reventon_motion_id ? [[node.extras.reventon_motion_id, index]] : [],
  ),
)
const rootName = PropertyBinding.sanitizeNodeName(glb.scenes[glb.scene || 0].name)
const localMatrix = (node) =>
  node.matrix
    ? new Matrix4().fromArray(node.matrix)
    : new Matrix4().compose(
        new Vector3().fromArray(node.translation || [0, 0, 0]),
        new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale || [1, 1, 1]),
      )
function localBounds(index, transform = new Matrix4(), result = new Box3()) {
  const node = glb.nodes[index]
  if (node.mesh != null)
    for (const primitive of glb.meshes[node.mesh].primitives) {
      const positions = glb.accessors[primitive.attributes.POSITION]
      if (!positions.min || !positions.max) throw new Error('Missing authored geometry bounds')
      result.union(
        new Box3(
          new Vector3().fromArray(positions.min),
          new Vector3().fromArray(positions.max),
        ).applyMatrix4(transform),
      )
    }
  for (const child of node.children || [])
    localBounds(child, transform.clone().multiply(localMatrix(glb.nodes[child])), result)
  return result
}
const staticAnchor = (name) => {
  const index = nodeIndices.get(name)
  if (index == null) throw new Error('Missing authored static surface: ' + name)
  return localBounds(index)
    .applyMatrix4(localMatrix(glb.nodes[index]))
    .getCenter(new Vector3())
    .toArray()
}
const rigAnchor = (id) => {
  const index = rigIndices.get(id)
  if (index == null) throw new Error('Missing authored motion group: ' + id)
  return localBounds(index).getCenter(new Vector3()).toArray()
}
const rigNode = (id) => PropertyBinding.sanitizeNodeName(glb.nodes[rigIndices.get(id)].name)
const trackById = new Map(motion.tracks.map((track) => [track.id, track]))
function rotateTrack(id) {
  const frames = trackById.get(id).frames
  const rest = new Quaternion().fromArray(frames[0], 3).normalize()
  const target = new Quaternion().fromArray(frames[80], 3).normalize()
  const delta = rest.clone().invert().multiply(target).normalize()
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
  const axis = new Vector3(delta.x, delta.y, delta.z).normalize()
  let angle = 2 * Math.atan2(Math.hypot(delta.x, delta.y, delta.z), delta.w)
  if ([axis.x, axis.y, axis.z].find((value) => Math.abs(value) > 1e-9) < 0) {
    axis.negate()
    angle = -angle
  }
  const rebuilt = rest.clone().multiply(new Quaternion().setFromAxisAngle(axis, angle))
  if (rebuilt.angleTo(target) > 1e-6 || Math.abs(angle) > Math.PI)
    throw new Error('Door rotation did not reproduce the authored open pose')
  return {
    node: rigNode(id),
    range: [0, 1],
    type: 'rotate',
    axis: axis
      .toArray()
      .map((value) => (Math.abs(Math.abs(value) - 1) < 1e-12 ? Math.sign(value) : value)),
    angle,
  }
}
function translateTrack(id) {
  const frames = trackById.get(id).frames
  return {
    node: rigNode(id),
    range: id.startsWith('door') ? [0, 0.45] : id.startsWith('wheel') ? [0.2, 0.75] : [0.45, 1],
    type: 'translate',
    offset: frames[263].slice(0, 3).map((value, index) => value - frames[0][index]),
  }
}
const doorIds = ['door_1', 'door_-1']
const moving = [
  ...doorIds,
  'wheel_1_1',
  'wheel_-1_1',
  'wheel_1_-1',
  'wheel_-1_-1',
  'rear_cover_assembly',
]
const hotspots = [
  {
    id: 'body',
    node: rootName,
    name: '楔形车身',
    anchor: staticAnchor('fixed__15023'),
    description: '沿低矮轮廓观察折面、边缘与表面反射。此处展示现有模型外观，不推断真实尺寸或性能。',
    cameraOffset: [3.2, 1.6, -3.8],
    group: '外观',
  },
  {
    id: 'cabin',
    node: rootName,
    name: '座舱',
    anchor: staticAnchor('fixed__18661'),
    description: '打开双门后，从侧面查看座椅、中控和碳纤维区域。可自由旋转寻找合适的观察角度。',
    cameraOffset: [1.8, 0.8, -1.1],
    group: '座舱',
  },
  {
    id: 'headlights',
    node: rootName,
    name: '前灯轮廓',
    anchor: staticAnchor('fixed__19931'),
    description: '观察前灯轮廓、灯罩与车身折面之间的关系。',
    cameraOffset: [1.4, 0.6, -1.8],
    group: '外观',
  },
  ...moving.map((id) => ({
    id,
    node: rigNode(id),
    anchor: rigAnchor(id),
    name:
      id === 'rear_cover_assembly'
        ? '后舱盖'
        : id.startsWith('door')
          ? id === 'door_1'
            ? '右侧车门'
            : '左侧车门'
          : `${id.split('_')[1] === '1' ? '右' : '左'}${id.endsWith('_1') ? '前' : '后'}轮组件`,
    description: id.startsWith('door')
      ? '车门沿已整理的轴心升起，分离时保持开合姿态。'
      : id.startsWith('wheel')
        ? '轮胎、轮毂与制动部件作为现有刚性组件一起移开，便于对照观察。'
        : '后舱盖按预设位移移开；未制作真实支撑机构或维修拆卸过程。',
    cameraOffset: id.startsWith('wheel')
      ? [id.includes('_1_') ? 1.6 : -1.6, 0.65, -0.6]
      : id.startsWith('door')
        ? [id === 'door_1' ? 1.8 : -1.8, 1.0, -1.2]
        : [2.2, 1.8, 2.4],
    group: id.startsWith('door') ? '车门' : id.startsWith('wheel') ? '车轮' : '后部结构',
  })),
].map((hotspot) => ({ ...hotspot, marker: true }))
const camera = {
  position: [3.9, 2.05, -5.65],
  target: [0, 0.72, -0.2],
  minDistance: 0.3,
  maxDistance: 24,
}
const product = {
  slug: 'reventon',
  name: 'Reventón 汽车',
  category: '汽车',
  description: '从楔形轮廓到座舱与部件层次，自由观察双门开合和七组组件分离。',
  cover: '/covers/workbench/reventon-real.png',
  displayStatus: 'formal',
  presentation: {
    version: 3,
    source: {
      kind: 'glb',
      adapter: 'reventon-v1',
      bundle: {
        id: manifest.id,
        version: 1,
        manifest: '/models/reventon/workbench-manifest.json',
        sha256: digest(manifestText),
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      finishMaterials: glb.materials
        .filter((material) => /\/ 15023$/.test(material.name))
        .map((material) => material.name),
      explode: [],
    },
    stage: {
      background: '#f7f5ef',
      ground: '#f7f5ef',
      groundY: -0.01,
      exposure: 1,
      environmentIntensity: 1.3,
      environmentFile: 'studio.exr',
      ambient: 0.18,
      key: { position: [-3, 6, 4], color: '#fffaf6', intensity: 0.25 },
      rim: { position: [4, 3, -2], color: '#f4f6ff', intensity: 0.15 },
    },
    camera,
    views: [
      { id: 'perspective', label: '整车全景', position: camera.position, target: camera.target },
      { id: 'front', label: '正面轮廓', position: [0, 1.4, -7.5], target: [0, 0.55, -0.9] },
      { id: 'side', label: '侧面轮廓', position: [7.4, 1.7, -0.2], target: camera.target },
      { id: 'rear', label: '后部轮廓', position: [-4.6, 2.2, 6.5], target: [0, 0.6, 0.6] },
      {
        id: 'car-cabin',
        label: '座舱观察',
        position: [2.6, 1.0, 0.8],
        target: staticAnchor('fixed__18661'),
      },
      {
        id: 'car-structure',
        label: '结构全景',
        position: [5.1, 3.5, -6.25],
        target: [0, 0.85, -0.1],
      },
    ],
    hotspots,
    finishes: [
      { id: 'original', name: '原始灰银外观', color: '#8b8e88' },
      { id: 'graphite', name: '深墨展示配色', color: '#1f2529' },
      { id: 'ivory', name: '暖白展示配色', color: '#d8d2bf' },
    ],
    actions: [
      {
        id: 'open-doors',
        label: '双门开合',
        kind: 'progress',
        node: rootName,
        motion: {
          duration: 2,
          openLabel: '打开双门',
          closeLabel: '关闭双门',
          tracks: doorIds.map(rotateTrack),
        },
      },
      {
        id: 'explore-parts',
        label: '部件分离',
        kind: 'progress',
        node: rootName,
        motion: {
          duration: 3.2,
          openLabel: '展开部件',
          closeLabel: '合拢部件',
          tracks: moving.map(translateTrack),
        },
      },
    ],
    structure: true,
    structureActionId: 'explore-parts',
    guide: [
      {
        id: 'whole',
        title: '从整车开始',
        description: '恢复完整姿态，自由观察车身、车门和车轮的整体关系。',
        overview: true,
      },
      {
        id: 'silhouette',
        title: '低矮轮廓与折面',
        description: '从正面比较前灯、车身折面与低矮轮廓。',
        view: 'front',
      },
      {
        id: 'doors',
        title: '打开双门',
        description: '双门沿同一进度开启。观察中可以暂停，旋转或选择部件。',
        view: 'perspective',
        progress: { actionId: 'open-doors', value: 1 },
      },
      {
        id: 'cabin',
        title: '靠近座舱',
        description: '沿已打开的车门观察座椅、中控和碳纤维区域。',
        view: 'car-cabin',
        progress: { actionId: 'open-doors', value: 1 },
      },
      {
        id: 'wheels',
        title: '车轮的相对位置',
        description: '对照轮胎、轮毂与车身的空间关系；这些现有组件会在下一阶段整体移开。',
        hotspotId: 'wheel_1_1',
        progress: { actionId: 'explore-parts', value: 0 },
      },
      {
        id: 'structure',
        title: '分开七组组件',
        description:
          '双门、四轮与后舱盖分阶段移开。引线标签跟随当前部件，这是结构观察演绎，不是真实维修顺序。',
        view: 'car-structure',
        progress: { actionId: 'explore-parts', value: 1 },
      },
      {
        id: 'return',
        title: '返回整车',
        description: '关闭双门、合拢各组件并恢复全景，保留展示配色。',
        overview: true,
      },
    ],
  },
}
if (product.presentation.source.finishMaterials.length !== 8)
  throw new Error('Expected exactly the eight original 15023 surface bindings')
await mkdir('server/src/main/resources/presentations', { recursive: true })
await writeFile(resolve(directory, 'workbench-manifest.json'), manifestText)
const configPath = 'server/src/main/resources/presentations/reventon-workbench-v1.json'
await writeFile(
  configPath,
  await format(JSON.stringify(product), {
    ...(await resolveConfig(configPath)),
    parser: 'json',
  }),
)
console.log(
  JSON.stringify({
    slug: product.slug,
    adapter: product.presentation.source.adapter,
    files: files.length,
    bytes: manifest.budget.maxBytes,
    triangles: manifest.budget.maxTriangles,
    hotspots: hotspots.length,
    motionGroups: moving.length,
    root: rootName,
    manifestSha256: product.presentation.source.bundle.sha256,
    doorAngles: product.presentation.actions[0].motion.tracks.map((track) => track.angle),
  }),
)
