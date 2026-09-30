import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const out = 'C:/Users/WindGear/AppData/Local/Temp/kimi-tw'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text().slice(0, 400))
})
await page.goto('http://127.0.0.1:4174/')
await page.waitForSelector('#loader.done', { timeout: 120000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}/1-assembled.png` })

// 进度 30%（机构分解中段）
await page.evaluate(
  `document.getElementById('slider').value = 300; document.getElementById('slider').dispatchEvent(new Event('input'))`,
)
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/2-exploded.png` })

// 进度 100%（平铺）
await page.evaluate(
  `document.getElementById('slider').value = 1000; document.getElementById('slider').dispatchEvent(new Event('input'))`,
)
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/3-flatlay.png` })

// 暗色主题平铺
await page.click('#btn-theme')
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/4-flatlay-dark.png` })
await page.click('#btn-theme')

// 回到整机，打开检视（点一个键帽位置附近）
await page.evaluate(
  `document.getElementById('slider').value = 0; document.getElementById('slider').dispatchEvent(new Event('input'))`,
)
await page.waitForTimeout(500)
// 用 JS 打开第一件键的检视（模拟点击行为）
const diag = await page.evaluate(`(() => {
  const fn = window.__openInspect
  if (!fn) return 'NO FN'
  try {
    fn('KE-001')
    const el = document.getElementById('inspect')
    return JSON.stringify({ cls: el.className, id: document.getElementById('in-id').textContent, display: getComputedStyle(el).display })
  } catch (e) { return 'ERR ' + e.message }
})()`)
console.log('[diag]', diag)
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/5-inspect.png` })
await page.click('#in-close')
await page.waitForTimeout(300)

// 击键演示
await page.keyboard.press('k')
await page.waitForTimeout(150)
await page.screenshot({ path: `${out}/6-strike.png` })

// 打字演示连拍
await page.click('#btn-type')
await page.waitForTimeout(700)
await page.screenshot({ path: `${out}/7-typing.png` })

const count = await page.textContent('#count')
console.log('[count]', count)
await browser.close()
console.log('done')
