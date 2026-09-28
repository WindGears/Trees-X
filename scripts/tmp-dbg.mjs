import { chromium } from '@playwright/test'
const base = process.env.CHECK_URL || 'http://127.0.0.1:4173'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message, '\n', e.stack))
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()))
await page.goto(`${base}/?product=typewriter-study`)
await page.waitForTimeout(5000)
const info = await page.evaluate(() => {
  const canvas = document.querySelector('.study-host canvas')
  const host = document.querySelector('.study-host')
  return {
    hasCanvas: !!canvas,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    hostSize: host ? [host.clientWidth, host.clientHeight] : null,
  }
})
console.log(JSON.stringify(info))
await page.screenshot({ path: '.impeccable/review/typewriter/debug.png' })
await browser.close()
