import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { packageAsset, digest, jsonText } from './asset-package.mjs'

const directory = 'public/models/bundles/speaker-engineering/v1'
try {
  await access(directory)
} catch {
  await packageAsset('public/models/form-01.glb', directory, {
    id: 'speaker-engineering',
    version: 1,
    maxTriangles: 16000,
    provenance: {
      author: 'Trees X project',
      source: 'scripts/create-demo-model.mjs',
      license: 'Project-authored procedural geometry',
      redistribution:
        'No external model assets; engineering fixture, not a quality-approved exhibit',
    },
  })
}
const sample = JSON.parse(
  await readFile('server/src/main/resources/samples/products.json', 'utf8'),
)[0]
const p = sample.presentation
p.version = 2
p.source = {
  kind: 'glb',
  adapter: 'pbr-v1',
  bundle: {
    id: 'speaker-engineering',
    version: 1,
    manifest: '/models/bundles/speaker-engineering/v1/manifest.json',
    sha256: digest(await readFile(directory + '/manifest.json')),
  },
  transform: { position: [0, 1.12, 0], rotation: [0, 0, 0], scale: 1 },
  finishMaterials: ['Chassis_Aluminium'],
  explode: [
    ...[
      'Front_Baffle',
      'Woofer_Frame',
      'Woofer_Bed',
      'Woofer_Surround',
      'Woofer_Cone',
      'Woofer_Dustcap',
      'Tweeter_Frame',
      'Tweeter_Surround',
      'Tweeter_Dome',
      'Front_Fastener_0',
      'Front_Fastener_1',
      'Front_Fastener_2',
      'Front_Fastener_3',
      'Indicator',
    ].map((node) => ({ node, offset: [0, 0, 0.35] })),
    ...['Rear_Panel', 'Rear_Port_Rim', 'Rear_Port', 'Rear_Connector'].map((node) => ({
      node,
      offset: [0, 0, -0.5],
    })),
  ],
}
p.stage = {
  background: '#151c25',
  ground: '#05080d',
  groundY: -0.04,
  exposure: 1.1,
  environmentIntensity: 0.7,
  ambient: 0.25,
  key: { position: [3, 6, 4], intensity: 3.5, color: '#eef5ff' },
  rim: { position: [-4, 3, -2], intensity: 2, color: '#afbdd4' },
}
const nodes = { driver: 'Woofer_Cone', knob: 'Volume_Dial', shell: 'Chassis' }
p.hotspots.forEach((h) => {
  h.node = nodes[h.node]
})
p.actions.forEach((a) => {
  a.node = 'Volume_Dial'
  a.behavior = { type: 'rotate', axis: [0, 1, 0], amount: 1.2 }
})
sample.displayStatus = 'prototype'
sample.description = '现有音箱 GLB，用于验证正式资产接入、部件与动作；尚未通过正式展品质检。'
await mkdir('server/src/test/resources/fixtures', { recursive: true })
await writeFile('server/src/test/resources/fixtures/speaker-glb-v2.json', await jsonText(sample))
console.log('Created engineering-only v2 fixture; public product records are unchanged.')
