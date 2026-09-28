import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const source = resolve(process.argv[2] ?? '../heritage-museum/heritage-web/public')
const records = [
  ['gamepad', 'Josh Dean', 'https://polyhaven.com/a/gamepad'],
  ['gaming-console', 'Sean Buckley', 'https://polyhaven.com/a/gaming_console'],
  ['oak-side-table', 'James Ray Cock', 'https://polyhaven.com/a/side_table_01'],
  ['potted-plant', 'Rico Cilliers', 'https://polyhaven.com/a/potted_plant_01'],
  ['home-furniture-set', 'Kenney', 'https://kenney.nl/assets/furniture-kit'],
  ['toy-racer', 'Kenney', 'https://kenney.nl/assets/car-kit'],
]
await mkdir('public/models/collection', { recursive: true })
await mkdir('public/covers', { recursive: true })
await mkdir('public/draco', { recursive: true })
const manifest = []
for (const [id, author, url] of records) {
  const input = resolve(source, 'models', id, `${id}.glb`)
  const data = await readFile(input)
  const gltf = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)))
  const triangles = gltf.nodes.reduce(
    (total, node) =>
      total +
      (gltf.meshes[node.mesh]?.primitives ?? []).reduce(
        (sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3,
        0,
      ),
    0,
  )
  if (triangles > 100000 || data.length > 5 * 1024 * 1024) throw new Error(`Budget exceeded: ${id}`)
  await copyFile(input, `public/models/collection/${id}.glb`)
  await copyFile(resolve(source, 'covers', `${id}.jpg`), `public/covers/${id}.jpg`)
  manifest.push({
    id,
    author,
    source: url,
    license: 'CC0-1.0',
    licenseEvidence: 'heritage-museum/docs/assets/ASSET_MANIFEST.md',
    file: `public/models/collection/${id}.glb`,
    bytes: data.length,
    triangles,
    sha256: createHash('sha256').update(data).digest('hex'),
    nodes: gltf.nodes.map((node) => node.name),
  })
}
for (const name of ['draco_wasm_wrapper.js', 'draco_decoder.wasm']) {
  await copyFile(`node_modules/three/examples/jsm/libs/draco/gltf/${name}`, `public/draco/${name}`)
}
await writeFile('public/models/collection/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(
  JSON.stringify(
    manifest.map(({ id, bytes, triangles }) => ({ id, bytes, triangles })),
    null,
    2,
  ),
)
