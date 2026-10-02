import { chromium, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { checks: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(`${base}/?legacy=1&product=reventon`)
  const host = page.locator('.reventon-experience')
  await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  await page.evaluate(() => {
    let component = document.querySelector('canvas').__vueParentComponent
    while (component) {
      const context =
        component.exposed?.context ??
        Reflect.ownKeys(component.provides ?? {})
          .map((key) => component.provides[key])
          .find((value) => value?.scene?.value?.isScene)
      if (context?.scene?.value) {
        const groups = []
        context.scene.value.traverse((object) => {
          if (object.userData.reventon_motion_id) groups.push(object)
        })
        const camera = context.camera.activeCamera?.value ?? context.camera.value
        window.__playbackTrace = []
        window.__playbackTimer = window.setInterval(() => {
          const host = document.querySelector('.reventon-experience')
          window.__playbackTrace.push({
            time: window.performance.now(),
            seconds: Number(host.dataset.seconds),
            chapter: host.dataset.chapter,
            camera: camera.position.toArray(),
            groups: groups.map((object) => ({
              id: object.userData.reventon_motion_id,
              position: object.position.toArray(),
              rotation: object.quaternion.toArray(),
            })),
          })
        }, 100)
        return
      }
      component = component.parent
    }
    throw new Error('Actual Three scene unavailable')
  })
  await page.getByRole('button', { name: '播放演示', exact: true }).click()
  await expect(host).toHaveAttribute('data-seconds', '15.958', { timeout: 90000 })
  await expect(page.getByRole('button', { name: '播放演示', exact: true })).toBeVisible()
  const trace = await page.evaluate(() => {
    window.clearInterval(window.__playbackTimer)
    return window.__playbackTrace
  })
  expect([...new Set(trace.map((sample) => sample.chapter))]).toEqual([
    '开启',
    '座舱',
    '展开',
    '合拢',
  ])
  expect(trace.length).toBeGreaterThan(30)
  const distinct = trace[0].groups.map((group, index) => ({
    id: group.id,
    poses: new Set(
      trace.map((sample) =>
        [...sample.groups[index].position, ...sample.groups[index].rotation]
          .map((value) => value.toFixed(4))
          .join(','),
      ),
    ).size,
  }))
  for (const group of distinct) expect(group.poses, group.id).toBeGreaterThan(5)
  report.playback = { samples: trace.length, distinct, trace }
  report.checks.push('uninterrupted play visits all four chapters and moves all 7 real groups')
  const progress = page.getByRole('slider', { name: '演示进度' })
  await progress.focus()
  await page.keyboard.press('Home')
  await expect(host).toHaveAttribute('data-seconds', '0.000')
  await page.keyboard.press('ArrowRight')
  await expect(host).toHaveAttribute('data-seconds', '0.010')
  await page.keyboard.press('End')
  await expect(host).toHaveAttribute('data-seconds', '15.958')
  report.checks.push('keyboard Home, ArrowRight and End scrub the real director')
  expect(report.errors).toEqual([])
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await writeFile('.impeccable/review/reventon/playback.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ checks: report.checks, errors: report.errors, error: report.error }))
  await browser.close()
}
