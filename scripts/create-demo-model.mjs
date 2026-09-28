import { mkdir } from 'node:fs/promises'
import { Document, NodeIO } from '@gltf-transform/core'
import {
  CylinderGeometry,
  TorusGeometry,
  SphereGeometry,
  LatheGeometry,
  Vector2,
  Quaternion,
  Euler,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const doc = new Document()
const buffer = doc.createBuffer()
const scene = doc.createScene('FORM_01')
const root = doc.createNode('FORM_01_Root')
scene.addChild(root)
const metal = doc
  .createMaterial('Chassis_Aluminium')
  .setBaseColorFactor([0.58, 0.61, 0.66, 1])
  .setMetallicFactor(0.88)
  .setRoughnessFactor(0.3)
const darkMetal = doc
  .createMaterial('Anodized_Graphite')
  .setBaseColorFactor([0.045, 0.05, 0.065, 1])
  .setMetallicFactor(0.72)
  .setRoughnessFactor(0.32)
const rubber = doc
  .createMaterial('Driver_Rubber')
  .setBaseColorFactor([0.018, 0.02, 0.025, 1])
  .setMetallicFactor(0.01)
  .setRoughnessFactor(0.84)
const cone = doc
  .createMaterial('Driver_Diaphragm')
  .setBaseColorFactor([0.075, 0.08, 0.09, 1])
  .setMetallicFactor(0.28)
  .setRoughnessFactor(0.48)
const light = doc
  .createMaterial('Indicator_Blue')
  .setBaseColorFactor([0.4, 0.58, 1, 1])
  .setEmissiveFactor([0.2, 0.32, 0.7])

function add(name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], parent = root) {
  const primitive = doc.createPrimitive().setMaterial(material)
  for (const [attribute, semantic] of [
    ['position', 'POSITION'],
    ['normal', 'NORMAL'],
    ['uv', 'TEXCOORD_0'],
  ]) {
    const data = geometry.getAttribute(attribute)
    primitive.setAttribute(
      semantic,
      doc
        .createAccessor()
        .setType(attribute === 'uv' ? 'VEC2' : 'VEC3')
        .setArray(new Float32Array(data.array))
        .setBuffer(buffer),
    )
  }
  if (geometry.index) {
    primitive.setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(geometry.index.array))
        .setBuffer(buffer),
    )
  }
  const mesh = doc.createMesh(name).addPrimitive(primitive)
  const quaternion = new Quaternion().setFromEuler(new Euler(...rotation))
  const node = doc
    .createNode(name)
    .setMesh(mesh)
    .setTranslation(position)
    .setRotation(quaternion.toArray())
  parent.addChild(node)
  geometry.dispose()
  return node
}

const facing = [Math.PI / 2, 0, 0]
add('Chassis', new RoundedBoxGeometry(1.42, 2.08, 1.1, 4, 0.14), metal)
add('Front_Baffle', new RoundedBoxGeometry(1.27, 1.9, 0.05, 3, 0.12), darkMetal, [0, 0, 0.551])
add('Rear_Panel', new RoundedBoxGeometry(1.14, 1.69, 0.026, 2, 0.06), darkMetal, [0, 0, -0.551])
add('Base', new RoundedBoxGeometry(1.29, 0.095, 0.96, 2, 0.035), rubber, [0, -1.04, 0])
add('Woofer_Frame', new CylinderGeometry(0.515, 0.515, 0.04, 80), metal, [0, -0.32, 0.593], facing)
add('Woofer_Bed', new CylinderGeometry(0.485, 0.485, 0.055, 80), rubber, [0, -0.32, 0.617], facing)
add('Woofer_Surround', new TorusGeometry(0.418, 0.045, 12, 80), rubber, [0, -0.32, 0.65])
const profile = [
  [0.0, -0.065],
  [0.14, -0.065],
  [0.2, -0.059],
  [0.37, 0.006],
  [0.397, 0.009],
].map(([x, y]) => new Vector2(x, y))
add('Woofer_Cone', new LatheGeometry(profile, 80), cone, [0, -0.32, 0.638], facing)
const cap = new SphereGeometry(0.158, 40, 20)
cap.scale(1, 1, 0.4)
add('Woofer_Dustcap', cap, darkMetal, [0, -0.32, 0.594])
add('Tweeter_Frame', new CylinderGeometry(0.234, 0.234, 0.04, 64), metal, [0, 0.52, 0.593], facing)
add('Tweeter_Surround', new TorusGeometry(0.186, 0.026, 10, 64), rubber, [0, 0.52, 0.621])
const tweeter = new SphereGeometry(0.165, 32, 16)
tweeter.scale(1, 1, 0.45)
add('Tweeter_Dome', tweeter, cone, [0, 0.52, 0.614])
add('Volume_Base', new CylinderGeometry(0.143, 0.16, 0.035, 48), rubber, [0.32, 1.045, 0])
const dial = add(
  'Volume_Dial',
  new CylinderGeometry(0.14, 0.14, 0.115, 96),
  metal,
  [0.32, 1.095, 0],
)
for (let i = 0; i < 72; i++) {
  const angle = (i / 72) * Math.PI * 2
  add(
    `Dial_Knurl_${i}`,
    new CylinderGeometry(0.002, 0.002, 0.098, 5),
    metal,
    [Math.sin(angle) * 0.139, 0, Math.cos(angle) * 0.139],
    [0, 0, 0],
    dial,
  )
}
add('Dial_Top', new CylinderGeometry(0.126, 0.13, 0.003, 96), metal, [0, 0.058, 0], [0, 0, 0], dial)
add(
  'Dial_Index',
  new RoundedBoxGeometry(0.007, 0.002, 0.033, 1, 0.001),
  darkMetal,
  [0, 0.061, 0.091],
  [0, 0, 0],
  dial,
)
for (let i = 0; i < 4; i++) {
  add(
    `Dial_Groove_${i}`,
    new TorusGeometry(0.14, 0.0025, 4, 64),
    darkMetal,
    [0.32, 1.06 + i * 0.02, 0],
    facing,
  )
}
add('Indicator', new RoundedBoxGeometry(0.04, 0.011, 0.009, 1, 0.003), light, [0, -0.923, 0.585])
for (const [i, x, y] of [
  [0, -0.51, 0.79],
  [1, 0.51, 0.79],
  [2, -0.51, -0.79],
  [3, 0.51, -0.79],
]) {
  const fastener = add(
    `Front_Fastener_${i}`,
    new CylinderGeometry(0.026, 0.026, 0.008, 12),
    metal,
    [x, y, 0.582],
    facing,
  )
  add(
    `Fastener_Slot_${i}`,
    new RoundedBoxGeometry(0.032, 0.002, 0.005, 1, 0.001),
    darkMetal,
    [0, 0.005, 0],
    [0, 0, 0],
    fastener,
  )
}
add('Rear_Port_Rim', new TorusGeometry(0.22, 0.018, 8, 48), metal, [0, 0.35, -0.576])
add('Rear_Port', new CylinderGeometry(0.208, 0.208, 0.028, 48), rubber, [0, 0.35, -0.576], facing)
add(
  'Rear_Connector',
  new RoundedBoxGeometry(0.16, 0.061, 0.025, 2, 0.02),
  metal,
  [0, -0.48, -0.578],
)
doc.getRoot().setDefaultScene(scene)
await mkdir('public/models', { recursive: true })
await new NodeIO().write('public/models/form-01.glb', doc)
console.log('Created public/models/form-01.glb — original concept geometry, no external assets.')
