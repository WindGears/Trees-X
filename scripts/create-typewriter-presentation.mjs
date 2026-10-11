import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { packageAsset, digest, jsonText } from './asset-package.mjs'

const input = resolve(process.argv[2] || 'artifacts/typewriter-migration/export-v1')
const output = 'public/models/bundles/kimi-typewriter/v1'
const production = JSON.parse(await readFile(resolve(input, 'production.json'), 'utf8'))
const rig = JSON.parse(await readFile(resolve(input, 'rig.json'), 'utf8'))
const draft = JSON.parse(await readFile(resolve(input, 'bundle/manifest.json'), 'utf8'))
if (!process.argv.includes('--config-only'))
  await packageAsset(resolve(input, 'source.glb'), output, {
    id: 'kimi-typewriter',
    version: 1,
    maxTriangles: production.triangles,
    provenance: draft.provenance,
    extras: [{ path: 'rig.json', source: resolve(input, 'rig.json'), role: 'motion' }],
  })
if (!process.argv.includes('--config-only'))
  await copyFile(resolve(input, 'production.json'), resolve(output, 'source-record.json'))
else {
  const saved = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'))
  for (const file of saved.files)
    if (digest(await readFile(resolve(output, file.path))) !== file.sha256)
      throw new Error('Existing immutable resource changed: ' + file.path)
}
const groups = {
  keys: '键盘',
  levers: '键杠杆',
  typebars: '字杆',
  ribbon: '色带',
  carriage: '滚筒与滑架',
  frame: '机架',
  hardware: '连接件',
  shell: '外壳',
}
const notes = {
  keys: '观察键帽与下方的连接位置。击发演绎会同时带动对应键杠杆与字杆。',
  levers: '观察细长杆件与键盘、字杆区域的相对位置。联动按参考结构演绎。',
  typebars: '字杆以弧形排列，末端保留印字部位。击发时可以观察一根字杆的摆动。',
  ribbon: '观察色带卷轴及其附近部件。展开后可以从侧面查看原先相互遮挡的位置。',
  carriage: '观察滚筒、滑架与纸张所在的区域。分层用于展示这些部件的相对关系。',
  frame: '观察支撑其他部件的机架轮廓。展开与平铺均保留这个部件的独立身份。',
  hardware: '观察这件连接部件的形状与位置。此模型是参考资料重建，不作为维修装配图。',
  shell: '观察弧形外壳、边缘与表面反射。试色只改变外壳漆面的展示方案。',
}
const key = rig.parts.find((p) => p.group === 'keys' && /·\s*A$/.test(p.name))
if (!key) throw new Error('Missing A key in source rig')
const representative = new Map(
  Object.keys(groups).map((group) => [group, rig.parts.find((p) => p.group === group)]),
)
representative.set('keys', key)
const representativeNames = {
  keys: '按键 · 24 · A',
  typebars: '字杆 · 01',
  levers: '键杠杆 · 双臂连动件',
  frame: '机架 · 字杆定位架',
  shell: '外壳 · 后挡板',
  carriage: '滚筒与滑架 · 导轨支架',
  ribbon: '色带 · 供带卷轴',
  hardware: '连接件 · 开槽螺钉',
}
const hotspots = rig.parts.map((p) => ({
  id: p.node,
  node: p.node,
  name:
    representative.get(p.group)?.id === p.id
      ? representativeNames[p.group]
      : p.group === 'keys'
        ? '按键 · ' + p.name.replace(/^Key(cap)? /, '')
        : p.group === 'typebars'
          ? p.name.replace(/^Typebar /, '字杆 ')
          : p.group === 'levers'
            ? p.name.replace(/^Keylever /, '键杠杆 ')
            : `${groups[p.group]} · ${p.name}`,
  description: notes[p.group],
  group: groups[p.group],
  marker: representative.get(p.group)?.id === p.id,
  anchor: p.anchor,
  cameraOffset: [0.48, 0.32, 0.75],
}))
const camera = {
  position: [1.7248, 1.44152, 2.5604],
  target: [0, 0.47, -0.15],
  minDistance: 0.35,
  maxDistance: 14,
}
const product = {
  slug: 'typewriter-study',
  name: '机械打字机',
  category: '机械',
  description: '从一次按键，看到内部连接。自由观察整机、分层与部件平铺。',
  cover: '/covers/workbench/typewriter-study-real.png',
  displayStatus: 'formal',
  presentation: {
    version: 3,
    source: {
      kind: 'glb',
      adapter: 'typewriter-v1',
      bundle: {
        id: 'kimi-typewriter',
        version: 1,
        manifest: '/' + output.replace(/^public[\\/]/, '').replaceAll('\\', '/') + '/manifest.json',
        sha256: digest(await readFile(resolve(output, 'manifest.json'))),
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.16 },
      finishMaterials: ['enamel', 'shellGloss'],
      explode: [],
    },
    stage: {
      background: '#f7f5ef',
      ground: '#f7f5ef',
      groundY: -0.0192,
      exposure: 1,
      environmentIntensity: 1,
      ambient: 0.55,
      key: { position: [-1.12, 5.12, -0.8], color: '#fffaf6', intensity: 2.3 },
      rim: { position: [1.6, 2.4, 1.92], color: '#f4f6ff', intensity: 0.85 },
    },
    camera,
    views: [
      { id: 'perspective', label: '整机全景', position: camera.position, target: camera.target },
      { id: 'front', label: '正面', position: [0, 1.1, 3.9], target: camera.target },
      { id: 'side', label: '侧面', position: [3.9, 1.4, -0.15], target: camera.target },
      { id: 'top', label: '顶部', position: [0, 4, 0.2], target: camera.target },
      { id: 'structure', label: '展开全景', position: [3.6, 3.6, 5.1], target: [0, 0.75, -0.4] },
      { id: 'knoll', label: '平铺俯视', position: [0, 8, 0.01], target: [0, 0, 0] },
    ],
    hotspots,
    finishes: [
      { id: 'black', name: '缎黑漆面', color: '#111413' },
      { id: 'ivory', name: '象牙白漆面', color: '#d8d2bf' },
      { id: 'forest', name: '墨绿漆面', color: '#2d4139' },
    ],
    actions: [
      {
        id: 'press-key',
        label: '击发 A 键',
        kind: 'pulse',
        node: key.node,
        behavior: { type: 'typewriter-strike', index: key.index },
      },
      {
        id: 'explore-layout',
        label: '探索部件关系',
        kind: 'progress',
        node: 'typewriter-product',
        motion: {
          duration: 4,
          openLabel: '平铺部件',
          closeLabel: '合拢整机',
          program: { type: 'typewriter-layout-v1', file: 'rig.json' },
        },
      },
    ],
    structure: true,
    structureActionId: 'explore-layout',
    guide: [
      {
        id: 'whole',
        title: '先看整机',
        description: '观察弧形外壳、键盘与后方滚筒的整体关系。',
        view: 'perspective',
        progress: { actionId: 'explore-layout', value: 0 },
      },
      {
        id: 'input',
        title: '一次按键的连接',
        description: '点击击发 A 键，观察按键、键杠杆与字杆一起变化。此处展示参考结构的联动演绎。',
        hotspotId: key.node,
        actionId: 'press-key',
        progress: { actionId: 'explore-layout', value: 0 },
      },
      {
        id: 'layers',
        title: '分层看机构',
        description: '外壳与内部部件按组展开。可以暂停导览，选择任意部件靠近观察。',
        view: 'structure',
        progress: { actionId: 'explore-layout', value: 0.6 },
      },
      {
        id: 'flat',
        title: '把部件平铺',
        description: '572 个部件保留独立身份。打开细节面板，可按部件组或名称查找。',
        view: 'knoll',
        progress: { actionId: 'explore-layout', value: 1 },
      },
      {
        id: 'return',
        title: '返回整机',
        description: '合拢部件，保留刚才选择的外壳配色。',
        overview: true,
      },
    ],
  },
}
await mkdir('server/src/main/resources/presentations', { recursive: true })
await writeFile(
  'server/src/main/resources/presentations/typewriter-kimi-v1.json',
  await jsonText(product),
)
console.log(
  JSON.stringify({
    path: output,
    parts: hotspots.length,
    key: { node: key.node, index: key.index },
    sha256: product.presentation.source.bundle.sha256,
  }),
)
