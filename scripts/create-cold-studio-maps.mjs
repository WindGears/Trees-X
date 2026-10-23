import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const root = 'public/studio/cold-studio/concept-v2'
await mkdir(root, { recursive: true })
const records = []
for (const role of ['floor', 'wall']) {
  const size = 1024,
    norm = new Uint8Array(size * size * 3),
    rough = new Uint8Array(size * size)
  // Periodic, seeded multiscale grain; coherent sine waves produced visible
  // diagonal bands under grazing light and are intentionally not used.
  const noise = (x, y, cell) => {
    const period = size / cell,
      px = x / cell,
      py = y / cell
    const ix = Math.floor(px),
      iy = Math.floor(py)
    const smooth = (t) => t * t * (3 - 2 * t)
    const u = smooth(px - ix),
      v = smooth(py - iy)
    const hash = (a, b) => {
      a = ((a % period) + period) % period
      b = ((b % period) + period) % period
      let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ (role === 'floor' ? 193 : 719)
      n = Math.imul(n ^ (n >>> 13), 1274126177)
      return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1
    }
    return (
      (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) +
      (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v
    )
  }
  const f = (x, y) => noise(x, y, 4) * 0.5 + noise(x, y, 16) * 0.3 + noise(x, y, 64) * 0.2
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        amp = role === 'floor' ? 0.06 : 0.018,
        dx = (f(x + 1, y) - f(x - 1, y)) * amp,
        dy = (f(x, y + 1) - f(x, y - 1)) * amp,
        l = Math.hypot(dx, dy, 1)
      norm[i * 3] = Math.round(((-0.5 * dx) / l + 0.5) * 255)
      norm[i * 3 + 1] = Math.round(((-0.5 * dy) / l + 0.5) * 255)
      norm[i * 3 + 2] = Math.round((0.5 / l + 0.5) * 255)
      rough[i] = Math.round(
        ((role === 'floor' ? 0.32 : 0.85) + (role === 'floor' ? 0.035 : 0.018) * f(x, y)) * 255,
      )
    }
  await sharp(norm, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toFile(`${root}/${role}-normal.png`)
  await sharp(rough, { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toFile(`${root}/${role}-roughness.png`)
  for (const channel of ['albedo', 'normal', 'roughness']) {
    const file = `${role}-${channel}.png`,
      bytes = await readFile(`${root}/${file}`),
      m = await sharp(bytes).metadata()
    records.push({
      role,
      channel: channel === 'albedo' ? 'basecolor' : channel,
      file,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: m.width,
      height: m.height,
    })
  }
}
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify(
    {
      id: 'cold-studio-concept-v2',
      records,
      source:
        'GPT generated albedo masters at native 1254x1254; independently authored periodic normal and roughness, not measured PBR or recovered height.',
    },
    null,
    2,
  ),
)
await writeFile(
  'src/lib/workbench/rendering/carShowroom/assetRecords.ts',
  'export const showroomAssetRecords = ' + JSON.stringify(records, null, 2) + ' as const\n',
)
console.log(records.map((x) => [x.file, x.width, x.height]))
