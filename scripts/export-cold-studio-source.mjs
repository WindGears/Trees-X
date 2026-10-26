import { build } from 'rolldown'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const revision = process.argv.includes('--refined') ? 11 : 10
const output = `artifacts/car-showroom/cycles-r${revision}`
await mkdir(output, { recursive: true })
await build({
  input: 'src/lib/workbench/rendering/carShowroom/geometry.ts',
  external: (id) => id === 'three' || id.startsWith('three/'),
  output: { file: `${output}/geometry.mjs`, format: 'esm' },
})
const { createColdStudioGeometry } = await import(pathToFileURL(resolve(`${output}/geometry.mjs`)))
await build({
  input: 'src/lib/workbench/rendering/carShowroom/config.ts',
  output: { file: `${output}/config.mjs`, format: 'esm' },
})
const configs = await import(pathToFileURL(resolve(`${output}/config.mjs`)))
const config = revision === 11 ? configs.refinedColdStudioConfig : configs.coldStudioConfig
const room = createColdStudioGeometry(config)
const meshes = []
room.root.traverse((object) => {
  if (!object.isMesh) return
  const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
  const material = object.material
  meshes.push({
    id: object.userData.showroomId,
    lightId: object.userData.showroomLightId ?? null,
    position: Array.from(geometry.attributes.position.array),
    normal: Array.from(geometry.attributes.normal.array),
    uv: geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null,
    material: {
      color: material.color.toArray(),
      roughness: material.roughness ?? 1,
      metalness: material.metalness ?? 0,
      clearcoat: material.clearcoat ?? 0,
      clearcoatRoughness: material.clearcoatRoughness ?? 0,
      normalScale: material.normalScale?.toArray() ?? [1, 1],
    },
  })
  geometry.dispose()
})
room.dispose()
const source = {
  config,
  meshes,
  textureDirectory: resolve('public/studio/cold-studio/concept-v2'),
}
const text = JSON.stringify(source)
await writeFile(`${output}/scene.json`, text)
console.log(
  JSON.stringify({
    output,
    meshes: meshes.length,
    sha256: createHash('sha256').update(text).digest('hex'),
  }),
)
