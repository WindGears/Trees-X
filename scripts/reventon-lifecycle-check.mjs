import { chromium, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { checks: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.route('**/models/reventon/motion.json', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  )
  await page.goto(`${base}/?product=reventon`)
  const host = page.locator('.reventon-experience')
  await expect(host).toHaveAttribute('data-status', 'error', { timeout: 180000 })
  await expect(page.getByRole('button', { name: '播放演示', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    window.__reventonCanvas = document.querySelector('canvas')
  })
  await page.unroute('**/models/reventon/motion.json')
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  expect(
    await page.evaluate(() => window.__reventonCanvas === document.querySelector('canvas')),
  ).toBe(true)
  report.checks.push('failed resource exposes retry; retry keeps original Canvas')
  const saved = await page.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((key) => component.provides[key])
          .find((value) => value?.scene?.value?.isScene)
      if (context?.scene?.value) {
        const renderer = context.renderer.instance
        window.__reventonContext = context
        window.__reventonRenderer = renderer
        window.__reventonDisposed = { geometry: 0, material: 0 }
        const seen = new Set()
        context.scene.value.traverse((o) => {
          if (!o.isMesh || !o.userData.source_object_count) return
          for (const [type, resource] of [
            ['geometry', o.geometry],
            ['material', o.material],
          ]) {
            if (seen.has(resource)) continue
            seen.add(resource)
            resource.addEventListener('dispose', () => window.__reventonDisposed[type]++)
          }
        })
        const extension = renderer.getContext().getExtension('WEBGL_lose_context')
        window.__reventonLoss = extension
        extension.loseContext()
        return true
      }
      component = component.parent
    }
    return false
  })
  expect(saved).toBe(true)
  await expect(host).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__reventonLoss.restoreContext())
  await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  const restored = await page.evaluate(() => ({
    canvas: window.__reventonCanvas === document.querySelector('canvas'),
    renderer: window.__reventonRenderer === window.__reventonContext.renderer.instance,
    disposed: window.__reventonDisposed,
  }))
  expect(restored.canvas).toBe(true)
  expect(restored.renderer).toBe(true)
  expect(restored.disposed.geometry).toBe(135)
  expect(restored.disposed.material).toBe(135)
  report.restored = restored
  await page.getByRole('button', { name: '展开', exact: true }).click()
  await expect(host).toHaveAttribute('data-seconds', '11.750')
  report.checks.push(
    'real WebGL context loss/restoration reuses renderer and disposes old geometry/material exactly once',
  )
  await page.getByRole('button', { name: '播放演示', exact: true }).click()
  await page.getByRole('button', { name: /商品目录/ }).click()
  const paused = await host.getAttribute('data-seconds')
  await page.waitForTimeout(500)
  expect(await host.getAttribute('data-seconds')).toBe(paused)
  await page.getByRole('button', { name: '展示陶盆绿植', exact: true }).click()
  await expect(host).toHaveCount(0)
  await expect(page.locator('.product-viewer')).toHaveAttribute('aria-busy', 'false', {
    timeout: 60000,
  })
  await expect(page.locator('canvas')).toHaveCount(1)
  await page.getByRole('button', { name: /商品目录/ }).click()
  await page.getByRole('button', { name: '展示兰博基尼 Reventón', exact: true }).click()
  await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(host).toHaveAttribute('data-seconds', '0.000')
  report.checks.push(
    'catalog pauses active timeline; exhibit leave and return keep only one active Canvas',
  )
  expect(report.errors).toEqual([])
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await writeFile('.impeccable/review/reventon/lifecycle.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
