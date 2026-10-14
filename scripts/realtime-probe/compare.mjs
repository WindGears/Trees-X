import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const before = process.argv[2],
  after = process.argv[3],
  output = process.argv[4]
if (!before || !after || !output)
  throw new Error('Usage: node scripts/realtime-probe/compare.mjs BEFORE AFTER OUTPUT')
const cases = [
    ['whole', '整机'],
    ['paint', '漆面'],
    ['metal', '金属'],
    ['key', '键帽'],
    ['layers', '分层 60%'],
    ['flat', '平铺 100%'],
  ],
  report = { inputContractsMatched: false, visualAcceptance: 'not evaluated', cases: [] }
const read = async (directory, id) =>
  JSON.parse(await readFile(join(directory, `quality-realtime-${id}.json`), 'utf8'))
for (const [id, title] of cases) {
  const a = await read(before, id),
    b = await read(after, id)
  const fields = [
    'roots',
    'source',
    'adapter',
    'bundle',
    'semanticParts',
    'sourceTriangles',
    'instances',
    'triangles',
    'cameraProjection',
    'selectedPart',
    'outputResolution',
    'pixelRatio',
    'poseDigest',
    'identityDigest',
    'sourceMaterialDigest',
    'partNamesDigest',
    'renderSettings',
  ]
  for (const field of fields) assert.deepEqual(b[field], a[field], `${id}: frozen ${field}`)
  const near = (field) => {
    assert.equal(a[field].length, b[field].length)
    const error = Math.max(...a[field].map((value, index) => Math.abs(value - b[field][index])))
    assert.ok(error <= 1e-6, `${id}: ${field} changed by ${error}`)
    return error
  }
  assert.deepEqual(Object.keys(a.motion), Object.keys(b.motion))
  for (const key of Object.keys(a.motion)) {
    assert.equal(a.motion[key].progress, b.motion[key].progress)
    assert.equal(a.motion[key].playing, false)
    assert.equal(b.motion[key].playing, false)
  }
  report.cases.push({
    id,
    title,
    fields,
    cameraError: near('camera'),
    projectionError: near('projection'),
    memoryBefore: a.memory,
    memoryAfter: b.memory,
  })
}
report.inputContractsMatched = true
await mkdir(output, { recursive: true })
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
const link = (directory, id) =>
  relative(output, join(directory, `quality-realtime-${id}.canvas.png`)).replaceAll('\\', '/')
await writeFile(
  join(output, 'index.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>打字机 HDR 中间纹理修正</title>
<style>body{margin:0;padding:28px;background:#eeefeb;color:#202820;font:16px/1.6 system-ui}
main{max-width:1800px;margin:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
figure{margin:0}img{width:100%;display:block}figcaption{padding:8px 0}
@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main>
<h1>打字机 · HDR 中间纹理修正</h1><p>左：原实时管线；右：显式 HalfFloat 修正。
六个取景已核对实际相机、模型姿态、源材质摘要、灯光、环境、曝光和输出尺寸。
这组只比较同一实时管线的纹理格式修正，不与不同布光的 WebGL 或旧路径图计算误差。</p>
<p>图像为正常浏览器画布截图。真实纹理读回另存于 SSR probe；截图为随后绘制帧，
不能视作四路读回的精确同帧输出。输入契约一致不代表画质验收通过，仍需人工检查。</p>
${cases.map(([id, title]) => `<h2>${title}</h2><div class="pair"><figure><img src="${link(before, id)}"><figcaption>修正前</figcaption></figure><figure><img src="${link(after, id)}"><figcaption>HalfFloat 修正后</figcaption></figure></div>`).join('\n')}
</main></html>`,
)
console.log(`Matched six frozen-input views: ${join(output, 'index.html')}`)
