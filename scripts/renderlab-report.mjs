import { readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const directory = resolve(process.argv[2] || 'artifacts/renderlab/production-final')
const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))
if (!report.passed || report.captures.length !== 15)
  throw new Error('三模式、五个共同取景未全部通过，不能生成已完成比较页')
const highDirectory = process.argv[3] ? resolve(process.argv[3]) : null
const high = highDirectory
  ? JSON.parse(await readFile(join(highDirectory, 'report.json'), 'utf8'))
  : null
if (high && !high.passed) throw new Error('高采样补充尚未通过')
const views = ['whole', 'paint', 'metal', 'layers', 'flat']
const modes = ['webgl', 'webgpu', 'pathtrace']
const names = { whole: '整机', paint: '漆面近景', metal: '金属近景', layers: '分层', flat: '平铺' }
const labels = { webgl: 'WebGL2 实时', webgpu: 'WebGPU 实时', pathtrace: '静止路径追踪' }
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const sections = views
  .map(
    (view) =>
      `<section data-view="${view}"><h2>${names[view]}</h2><div class="grid">${modes
        .map((mode) => {
          const run = report.runs.find(
            (item) => item.request.mode === mode && item.request.view === view,
          )
          if (!run) throw new Error('实际运行记录缺失')
          const supplement =
            mode === 'pathtrace'
              ? high?.runs.find((item) => item.request.view === view && item.request.mode === mode)
              : null
          if (supplement && JSON.stringify(supplement.identity) !== JSON.stringify(run.identity))
            throw new Error('高采样补充的资产、几何或姿态与基准不同')
          const png = supplement
            ? relative(directory, join(highDirectory, `${mode}-${view}.png`)).replaceAll('\\', '/')
            : `${mode}-${view}.png`
          const actual = supplement || run
          return `<figure><figcaption><strong>${labels[mode]}</strong><span>${mode === 'pathtrace' ? `最低 ${actual.runtime.samples.min} spp · 未降噪` : '按需绘制 · 可交互'}</span></figcaption><a href="${escape(png)}" target="_blank"><img width="1440" height="1000" src="${escape(png)}" alt="${labels[mode]} ${names[view]}" /></a>${supplement ? `<a href="${mode}-${view}.png" target="_blank">查看同取景 128 样本原图</a>` : ''}</figure>`
        })
        .join('')}</div></section>`,
  )
  .join('')
await writeFile(
  join(directory, 'comparison.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trees X · 同资产渲染比较</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#edf0eb;color:#243029;font:15px/1.6 system-ui,sans-serif}main{max-width:1920px;margin:auto}h1{font-size:28px;font-weight:600}p{max-width:1000px}nav{position:sticky;top:0;padding:12px 0;background:#edf0eb;z-index:1}button{font:inherit;background:#fff;border:1px solid #aab5aa;border-radius:6px;padding:7px 15px;margin-right:8px;cursor:pointer}button[aria-pressed=true]{background:#304838;color:#fff}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0}figcaption{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}span{color:#506052;font-size:12px}img{display:block;width:100%;height:auto;border:1px solid #bcc5bb}section[hidden]{display:none}details{margin:24px 0}code{overflow-wrap:anywhere;font-size:12px}li{margin:6px 0}@media(max-width:900px){.grid{grid-template-columns:1fr}body{padding:20px}figcaption{font-size:14px}}</style><main>
<h1>Trees X · 同资产、同取景渲染比较</h1><p>三模式均使用真实打字机 GLB、共同姿态、PBR 输入、HDR、三块面光源、1440×1000 和 DPR 1。每次仅运行一个 renderer。点击图片可查看原始像素；未对任一图片单独调色、锐化或缩放。</p>
<p>正式交互管线保留增强 WebGL2。基础 WebGPU 本轮没有显示独立画质跃升；路径追踪用于静止照明与反射参考，${high ? '整机与金属展示实际 1024 样本，其他取景为 128 样本' : '此处为实际 128 样本'}，均未降噪，采样颗粒不应被视为微表面纹理。共同实验场景不含生产反射镜面与接触阴影近似，不能把实验光栅画面直接当作生产画面。</p>
<nav aria-label="共同观察内容">${views.map((view, i) => `<button data-select="${view}" aria-pressed="${i === 0}">${names[view]}</button>`).join('')}</nav>${sections}
<details><summary>控制变量、限制与实际记录</summary><p>共同模型 SHA256：<code>${escape(report.runs[0].identity.model)}</code></p><ul>${report.runs[0].settings.differencesFromProduction.map((value) => `<li>${escape(value)}</li>`).join('')}</ul><p>高光差异还受 BRDF、PMREM 与纹理滤波路径影响，不能全部归因于全局光照。时间记录包含设置、着色器与采样，不是 GPU 帧耗时或生产帧率。</p><a href="report.json">完整自动化报告</a></details></main>
<script>const select=(view)=>{document.querySelectorAll('section[data-view]').forEach(n=>n.hidden=n.dataset.view!==view);document.querySelectorAll('button[data-select]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.select===view)))};document.querySelectorAll('button[data-select]').forEach(n=>n.addEventListener('click',()=>select(n.dataset.select)));select('whole');</script></html>`,
  'utf8',
)
console.log(join(directory, 'comparison.html'))
