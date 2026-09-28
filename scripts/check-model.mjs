import { stat } from 'node:fs/promises'
import { NodeIO } from '@gltf-transform/core'

const path = 'public/models/form-01.glb'
const document = await new NodeIO().read(path)
let triangles = 0
let primitives = 0
for (const node of document.getRoot().listNodes()) {
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    primitives++
    triangles +=
      (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3
  }
}
const { size } = await stat(path)
if (!triangles || triangles > 100_000 || size > 5 * 1024 * 1024) {
  throw new Error(`Model budget failed: ${triangles} triangles, ${size} bytes`)
}
console.log(JSON.stringify({ path, triangles, primitives, bytes: size, budget: 'pass' }, null, 2))
