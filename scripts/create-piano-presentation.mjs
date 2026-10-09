import { readFile, writeFile, mkdir, access, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest, jsonText, readGlb } from './asset-package.mjs'
const input = resolve('artifacts/piano-migration/export-v1/bundle')
const output = 'public/models/bundles/kimi-piano/v1'
if (!process.argv.includes('--config-only')) {
  try {
    await access(output)
    throw new Error('Existing runtime version must not be overwritten')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await cp(input, output, { recursive: true })
  await cp(resolve(input, '../source-record.json'), resolve(output, 'source-record.json'))
}
const rig = JSON.parse(await readFile(resolve(output, 'rig.json'), 'utf8'))
const glb = readGlb(await readFile(resolve(output, 'model.glb')))
const layerNames = {
  lids: '琴盖与谱架',
  case: '琴壳',
  support: '支撑',
  keyboard: '键盘',
  action: '击弦机构',
  damper: '制音器',
  strings: '弦列',
  plate: '铁板',
  bridges: '弦桥',
  soundboard: '音板',
  pedals: '踏板',
  unknown: '其他构件',
}
const notes = {
  lids: '观察琴盖、支杆与谱架的相对位置。',
  case: '观察弧形琴壳和键盘前方的外壳轮廓。',
  support: '观察琴腿、脚轮和连接部位。',
  keyboard: '观察键杆向钢琴内部延伸的位置。',
  action: '观察键盘上方的击弦机构及排列关系。',
  damper: '观察制音器与弦列的对应位置。',
  strings: '观察弦列的走向及与铁板、弦桥的关系。',
  plate: '观察铁板的开孔、支撑轮廓与弦列位置。',
  bridges: '观察弦桥在音板上的位置。',
  soundboard: '观察宽阔音板与上方弦列、弦桥的关系。',
  pedals: '观察踏板和向琴体连接的杆件。',
  unknown: '这个构件来自参考轮廓重建，可在全部平铺状态下对照观察；不作为维修装配图。',
}
const markerIds = new Set([
  'CFX-M07',
  'CFX-M01',
  'CFX-KEYFRAME',
  'BANK-W-1',
  'CFX-R01',
  'CFX-M03',
  'CFX-R02',
  'CFX-M13',
])
const mainNames = {
  'CFX-M07': '弧形琴壳',
  'CFX-M01': '主琴盖',
  'CFX-KEYFRAME': '键盘框架',
  'BANK-W-1': '击弦机构',
  'CFX-R01': '铸铁板',
  'CFX-M03': '音板',
  'CFX-R02': '弦桥',
  'CFX-M13': '踏板架',
}
const finishParts = new Set(
  rig.parts.filter((p) => ['CFX-M07', 'CFX-M01', 'CFX-M02'].includes(p.id)).map((p) => p.node),
)
const finishMaterials = new Set()
for (const node of glb.nodes) {
  if (!finishParts.has(node.extras?.pianoPart) || node.extras?.sectionCap || node.mesh == null)
    continue
  for (const primitive of glb.meshes[node.mesh].primitives) {
    const material = glb.materials[primitive.material],
      color = material?.pbrMetallicRoughness?.baseColorFactor
    if (color && Math.max(...color.slice(0, 3)) < 0.018) finishMaterials.add(material.name)
  }
}
const camera = {
  position: [-4.05, 3, -5.35],
  target: [-0.1, 1.07, 0],
  minDistance: 0.5,
  maxDistance: 35,
}
const chapterViews = [
  ['piano-section', '剖切取景', [-4.4, 2.8, -6.8], [-0.25, 1.35, 0]],
  ['piano-keys', '键盘取景', [-6.1, 2.65, -2.2], [-0.5, 1.3, -0.1]],
  ['piano-action', '击弦机构取景', [-5.8, 3.2, -4.8], [-0.5, 1.4, -0.2]],
  ['piano-strings', '弦列与铁板取景', [-3.4, 6.8, -5.8], [-0.35, 1.45, -0.8]],
  ['piano-soundboard', '音板取景', [1.6, 5.7, -6.8], [-0.15, 1.15, -1]],
  ['piano-dampers', '制音器取景', [-4.6, 2.9, -6], [-0.45, 1.25, -0.9]],
  ['knoll', '全部平铺俯视', [0, 13.5, 0.01], [0, 0.05, 0]],
]
const chapterNames = [
  '从整体开始',
  '看清内外层次',
  '向内部延伸的键杆',
  '排列在键盘上方的机构',
  '弦列与铁板',
  '音板与弦桥',
  '制音器与踏板',
  '全部平铺对照',
]
const descriptions = [
  '自由旋转，观察琴盖、键盘、琴壳和支撑之间的关系。',
  '模型沿预设平面分开两侧，便于查看原先遮挡的内部层次。',
  '键盘移到琴体前方。靠近观察长键杆和键盘框架。',
  '击弦机构移开并抬起，便于观察其部件排列及与键盘的关系。',
  '铁板与弦列移到琴体外侧。观察轮廓、弦列走向和支撑位置。',
  '音板和弦桥逐步分开。观察这两组结构与弦列的位置关系。',
  '制音器与踏板单独呈现，可从侧面比较它们的对应位置。',
  '823 个建模单元在更宽的布局中平铺；这是结构研究，不是真实维修拆解顺序。',
]
const product = {
  slug: 'piano-cfx',
  name: '三角钢琴',
  category: '乐器',
  description: '从键盘到音板，沿八个观察阶段探索内部结构。',
  cover: '/covers/workbench/piano-cfx-real.png',
  displayStatus: 'formal',
  presentation: {
    version: 3,
    source: {
      kind: 'glb',
      adapter: 'piano-v1',
      bundle: {
        id: 'kimi-piano',
        version: 1,
        manifest: '/models/bundles/kimi-piano/v1/manifest.json',
        sha256: digest(await readFile(resolve(output, 'manifest.json'))),
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      finishMaterials: [...finishMaterials],
      explode: [],
    },
    stage: {
      background: '#f7f5ef',
      ground: '#f7f5ef',
      groundY: -0.004,
      exposure: 0.95,
      environmentIntensity: 1,
      ambient: 1.2,
      key: { position: [-3.6, 9, -5], color: '#fff9ed', intensity: 2.4 },
      rim: { position: [7, 6, 4], color: '#f0f4ff', intensity: 1.05 },
    },
    camera,
    views: [
      { id: 'perspective', label: '整机全景', position: camera.position, target: camera.target },
      ...chapterViews.map(([id, label, position, target]) => ({ id, label, position, target })),
      { id: 'side', label: '侧面', position: [-6, 2.4, 1], target: [0, 1, 0] },
      { id: 'top', label: '顶部', position: [0, 8, 0.01], target: [0, 1, 0] },
    ],
    hotspots: rig.parts.map((part, i) => ({
      id: part.node,
      node: part.node,
      name: mainNames[part.id] || part.name || `${layerNames[part.layer]} ${i + 1}`,
      description: `${notes[part.layer]} 参考标识 ${part.id}。`,
      cameraOffset: [-1.4, 1.1, -1.6],
      group: layerNames[part.layer],
      marker: markerIds.has(part.id),
    })),
    finishes: [
      { id: 'black', name: '原始黑色漆面', color: '#090b0c' },
      { id: 'ivory', name: '象牙白展示配色', color: '#d8d2bf' },
    ],
    actions: [
      {
        id: 'sound-path',
        label: '从键盘到音板',
        kind: 'progress',
        node: 'piano-study',
        motion: {
          duration: 21,
          openLabel: '全部平铺',
          closeLabel: '返回整机',
          program: { type: 'piano-sound-path-v1', file: 'rig.json' },
        },
      },
    ],
    structure: true,
    structureActionId: 'sound-path',
    guide: [
      ...chapterNames.map((title, i) => ({
        id: 'chapter-' + i,
        title,
        description: descriptions[i],
        view: i === 0 ? 'perspective' : chapterViews[i - 1][0],
        progress: { actionId: 'sound-path', value: i / 7 },
      })),
      {
        id: 'return',
        title: '回到整机',
        description: '合拢各结构并恢复全景，保留展示配色。',
        overview: true,
      },
    ],
  },
}
await mkdir('server/src/main/resources/presentations', { recursive: true })
await writeFile(
  'server/src/main/resources/presentations/piano-kimi-v1.json',
  await jsonText(product),
)
console.log(
  JSON.stringify({
    slug: product.slug,
    units: rig.parts.length,
    finishes: finishMaterials.size,
    bundle: output,
    sha256: product.presentation.source.bundle.sha256,
  }),
)
