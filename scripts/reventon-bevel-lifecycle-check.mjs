/* global MutationObserver */
import assert from 'node:assert/strict'
import { URL } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import {
  attachShowroomBridge,
  showroomState,
  seekShowroomMotion,
} from './reventon-showroom/browser.mjs'

const output = 'artifacts/car-showroom/silver-seams-lifecycle'
const visual = JSON.parse(
  await readFile('artifacts/car-showroom/silver-seams-r18/report.json', 'utf8'),
)
const target = new URL(visual.runs.find((r) => r.mode === 'finish').url)
if (process.env.TREES_BEVEL_DEFAULT === '1') target.searchParams.delete('carBevelStudy')
const url = target.href
const report = { passed: false, url, errors: [] }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  const ready = async () => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'reventon', {
      timeout: 240000,
    })
    await expect(page.getByRole('slider', { name: '摄影棚照明', exact: true })).toBeVisible({
      timeout: 240000,
    })
    await attachShowroomBridge(page)
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            let count = 0
            window.__demo.scene.scene.value.traverse((o) => {
              if (o.isMesh && o.geometry.userData.paintBevelStudy) count++
            })
            return count
          }),
        { timeout: 240000 },
      )
      .toBe(4)
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(showroomState)
          return (
            s.product === 'reventon' &&
            s.lighting.phase === 'ready' &&
            s.lighting.keyShadow?.phase === 'ready' &&
            s.lighting.indirectLighting.actual === 'ddgi'
          )
        },
        { timeout: 240000 },
      )
      .toBe(true)
  }
  const watch = async () =>
    page.evaluate(() => {
      const items = []
      window.__demo.scene.scene.value.traverse((o) => {
        if (o.isMesh && o.geometry.userData.paintBevelStudy) {
          const item = { name: o.name, disposed: 0 }
          o.geometry.addEventListener('dispose', () => item.disposed++)
          items.push(item)
        }
      })
      window.__bevelDisposal = items
      return items.length
    })
  await page.goto(url)
  await ready()
  assert.equal(await watch(), 4)
  report.initial = await page.evaluate(showroomState)
  await page.evaluate(() => {
    window.__bevelInitialRenderer = window.__demo.renderer
  })
  await page.evaluate(() => window.__demo.store.select('typewriter-study'))
  await expect
    .poll(() => page.evaluate(() => window.__bevelDisposal.map((i) => i.disposed)), {
      timeout: 60000,
    })
    .toEqual([1, 1, 1, 1])
  report.switchDisposal = await page.evaluate(() => window.__bevelDisposal)
  await expect(page.locator('.workbench')).toHaveAttribute('data-slug', 'typewriter-study')
  await page.evaluate(() => window.__demo.store.select('reventon'))
  await ready()
  report.returned = await page.evaluate(showroomState)
  assert.equal(report.returned.canvases, 1)
  assert.equal(
    await page.evaluate(
      () => window.__bevelInitialRenderer === window.__demo.scene.renderer.instance,
    ),
    true,
  )
  assert.equal(report.returned.sha256, report.initial.sha256)
  await seekShowroomMotion(page, 'open-doors', 0.6)
  assert.equal(await watch(), 4)
  await page.evaluate(() => {
    window.__bevelLoss = { canvas: document.querySelector('canvas'), reason: null, maxCanvas: 1 }
    const observer = new MutationObserver(
      () =>
        (window.__bevelLoss.maxCanvas = Math.max(
          window.__bevelLoss.maxCanvas,
          document.querySelectorAll('canvas').length,
        )),
    )
    observer.observe(document.querySelector('#app'), { childList: true, subtree: true })
    window.__bevelLoss.observer = observer
    const device = window.__demo.scene.renderer.instance.backend.device
    void device.lost.then((info) => {
      window.__bevelLoss.reason = info.reason
    })
    device.destroy()
  })
  await page.waitForFunction(() => window.__bevelLoss.reason === 'destroyed', null, {
    timeout: 30000,
  })
  await page.waitForFunction(
    () => document.querySelector('canvas') !== window.__bevelLoss.canvas,
    null,
    { timeout: 60000 },
  )
  await ready()
  report.recovered = await page.evaluate(showroomState)
  report.loss = await page.evaluate(() => {
    window.__bevelLoss.observer.disconnect()
    return {
      reason: window.__bevelLoss.reason,
      maxCanvas: window.__bevelLoss.maxCanvas,
      disposal: window.__bevelDisposal,
    }
  })
  assert.equal(report.loss.maxCanvas, 1)
  assert.ok(report.loss.disposal.every((i) => i.disposed === 1))
  assert.equal(report.recovered.backend, 'webgpu')
  assert.equal(report.recovered.sha256, report.initial.sha256)
  assert.equal(report.recovered.motion['open-doors'].progress, 0.6)
  assert.equal(report.recovered.motion['open-doors'].playing, false)
  assert.deepEqual(report.recovered.gpuErrors, [])
  await page.screenshot({ path: output + '/recovered.png' })
  assert.deepEqual(report.errors, [])
  report.passed = true
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2))
}
