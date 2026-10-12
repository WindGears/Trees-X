import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = process.argv[2] || 'artifacts/hybrid-workbench/denoise-comparison'
const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))
if (!report.passed || report.errors.length)
  throw new Error('Only a passed actual comparison can generate a gallery')
const labels = {
    whole: '整机',
    paint: '漆面近景',
    metal: '金属近景',
    layers: '分层状态',
    flat: '平铺状态',
  },
  views = [...new Set(report.runs.map((run) => run.view))]
for (const view of views) {
  if (!Object.hasOwn(labels, view)) throw new Error('Unknown comparison view')
  for (const target of [32, 64, 128, 1024]) {
    const name = target === 1024 ? `raw-${view}-1024.png` : `denoised-${view}-${target}.png`
    const png = await readFile(join(directory, name))
    if (
      png.length < 24 ||
      png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.readUInt32BE(16) !== 1440 ||
      png.readUInt32BE(20) !== 1000
    )
      throw new Error('Missing or invalid full-resolution comparison image')
  }
}
const section = (view) => {
  const runs = report.runs.filter((run) => run.view === view)
  if (
    runs.length !== 4 ||
    ![32, 64, 128, 1024].every((target) => runs.some((run) => run.target === target))
  )
    throw new Error('Incomplete sample ladder')
  return `<section data-view="${view}"><h2>${labels[view]}</h2><div class="grid">${runs
    .map((run) => {
      const image =
          run.target === 1024 ? `raw-${view}-1024.png` : `denoised-${view}-${run.target}.png`,
        caption =
          run.target === 1024 ? '1024 样本原图 · 未降噪' : `${run.target} 样本 · OIDN 辅助引导降噪`,
        duration = run.denoise
          ? `完整降噪 ${(run.denoise.elapsedMs / 1000).toFixed(2)} 秒（含本次权重准备及辅助缓冲）`
          : '静止累积参考，不是无噪物理真值',
        rawLink =
          run.target < 1024 ? `<a href="raw-${view}-${run.target}.png">对应低样本原图</a>` : ''
      if (run.actualSamples.min !== run.target || run.actualSamples.max !== run.target)
        throw new Error('Actual sample count mismatch')
      return `<figure><a href="${image}"><img src="${image}" alt="${labels[view]} ${caption}" loading="lazy"></a><figcaption><strong>${caption}</strong><span>${duration}</span>${rawLink}</figcaption></figure>`
    })
    .join('')}</div></section>`
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trees X 降噪画质对照</title><style>body{margin:0;background:#edf0eb;color:#29352e;font:15px/1.65 Arial,sans-serif}header{padding:24px 32px;border-bottom:1px solid #bdc9c0}h1{margin:0;font-size:25px}p{margin:8px 0}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}button{font:inherit;color:inherit;background:transparent;padding:6px 14px;border:1px solid #94a698;border-radius:18px;cursor:pointer}button[aria-pressed=true]{background:#314c3d;color:white}main{padding:12px 20px}h2{font-size:20px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;display:block;border-radius:6px}figcaption{padding:8px;font-size:12px}strong,span{display:block}a{color:#285b3b}section[hidden]{display:none}@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><header><h1>低样本降噪与 1024 样本原图</h1><p>同一次真实 WebGPU 累积：32 → 64 → 128 → 1024；每次最低及最高样本数均已核对。同资产、材质、灯光、相机，1440×1000，DPR 1；12 次反弹，无能量截断与超分。</p><p>本页来自独立共同输入实验，不等同于正式工作台截图；点击图片查看原尺寸。检查文字、金属细边、微表面及阴影是否被降噪抹平。</p><nav>${views.map((view, index) => `<button data-view="${view}" aria-pressed="${index === 0}">${labels[view]}</button>`).join('')}</nav></header><main>${views.map(section).join('')}</main><script>const choose=v=>{document.querySelectorAll('section').forEach(s=>s.hidden=s.dataset.view!==v);document.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===v)))};document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.view)));choose('${views[0]}');</script></html>`
await writeFile(join(directory, 'comparison.html'), html)
console.log(join(directory, 'comparison.html'))
