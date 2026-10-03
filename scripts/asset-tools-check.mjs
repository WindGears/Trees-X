import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'

const output = '.impeccable/review/asset-ingestion'
await mkdir(output, { recursive: true })
const dir = await mkdtemp(join(output, 'orm-'))
const masks = [
  [0, 64, 128, 255],
  [255, 128, 64, 0],
  [15, 30, 45, 60],
]
const files = masks.map((_, index) => join(dir, `mask-${index}.png`))
for (let i = 0; i < masks.length; i++) {
  const data = Buffer.from(masks[i].flatMap((value) => [value, value, value]))
  await sharp(data, { raw: { width: 2, height: 2, channels: 3 } })
    .png()
    .toFile(files[i])
}
const packed = join(dir, 'orm.png')
const run = (args) =>
  spawnSync(process.execPath, ['scripts/asset-pack-orm.mjs', ...args], { encoding: 'utf8' })
const success = run([...files, packed])
assert.equal(success.status, 0, success.stderr)
const actual = await sharp(packed).raw().toBuffer()
assert.deepEqual(
  [...actual],
  masks[0].flatMap((_, pixel) => masks.map((mask) => mask[pixel])),
)
const original = await readFile(packed)
assert.notEqual(run([...files, packed]).status, 0, 'must reject overwriting a runtime version')
assert.deepEqual(await readFile(packed), original)
const wrongSize = join(dir, 'wrong-size.png')
await sharp({ create: { width: 3, height: 2, channels: 3, background: '#000000' } })
  .png()
  .toFile(wrongSize)
assert.notEqual(run([files[0], wrongSize, files[2], join(dir, 'rejected.png')]).status, 0)
const report = {
  passed: true,
  checks: [
    'all ORM pixel channels match input bytes',
    'existing output preserved',
    'mismatched dimensions rejected',
  ],
  dir,
}
await writeFile(output + '/orm.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
