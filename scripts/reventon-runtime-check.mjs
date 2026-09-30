import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { URL } from 'node:url'
const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = '.impeccable/review/reventon'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { errors: [], failed: [], external: [], poses: [], checks: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('requestfailed', (request) =>
    report.failed.push({ url: request.url(), reason: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (request.url().startsWith('http') && new URL(request.url()).origin !== new URL(base).origin)
      report.external.push(request.url())
  })
  await page.goto(`${base}/?product=reventon`)
  const host = page.locator('.reventon-experience')
  await expect(host).toHaveAttribute('data-status', 'ready', { timeout: 180000 })
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.locator('video')).toHaveCount(0)
  async function identity() {
    return page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      while (component) {
        const context =
          component.exposed?.context ??
          Reflect.ownKeys(component.provides ?? {})
            .map((key) => component.provides[key])
            .find((value) => value?.scene?.value?.isScene)
        if (context?.scene?.value) {
          const meshes = [],
            groups = []
          let triangles = 0,
            sourceObjects = 0,
            ao = 0,
            normals = 0
          context.scene.value.traverse((object) => {
            if (object.userData.reventon_motion_id)
              groups.push({
                id: object.userData.reventon_motion_id,
                position: object.position.toArray(),
                quaternion: object.quaternion.toArray(),
              })
            if (!object.isMesh || !object.userData.source_object_count) return
            meshes.push(object.name)
            triangles += object.geometry.index.count / 3
            sourceObjects += object.userData.source_object_count
            if (object.material.aoMap) ao++
            if (object.material.normalMap) normals++
          })
          const camera = context.camera.activeCamera?.value ?? context.camera.value
          return {
            meshes: meshes.length,
            triangles,
            sourceObjects,
            groups,
            ao,
            normals,
            camera: camera?.position.toArray(),
          }
        }
        component = component.parent
      }
      throw new Error('Actual Three scene not found')
    })
  }
  const first = await identity()
  expect(first.triangles).toBe(1500363)
  expect(first.sourceObjects).toBe(2998)
  expect(first.groups).toHaveLength(7)
  expect(first.ao).toBeGreaterThan(50)
  expect(first.normals).toBeGreaterThan(10)
  report.poses.push({ chapter: 'initial', ...first })
  await page.screenshot({ path: `${output}/desktop.png` })
  for (const chapter of ['开启', '座舱', '展开', '合拢']) {
    await page.getByRole('button', { name: chapter, exact: true }).click()
    await page.waitForTimeout(400)
    report.poses.push({ chapter, ...(await identity()) })
    await page.screenshot({ path: `${output}/${chapter}.png` })
  }
  expect(report.poses[1].groups).not.toEqual(first.groups)
  expect(report.poses[3].groups).not.toEqual(report.poses[1].groups)
  for (let i = 0; i < 7; i++) {
    const last = report.poses[4].groups[i]
    const initial = first.groups[i]
    last.position.forEach((value, axis) => expect(value).toBeCloseTo(initial.position[axis], 5))
  }
  report.checks.push('actual Three geometry, 7 moving groups, AO, normal maps, restored assembly')
  await page.getByRole('button', { name: '回到开始', exact: true }).click()
  await page.getByRole('button', { name: '播放演示', exact: true }).click()
  await page.waitForTimeout(900)
  expect(Number(await host.getAttribute('data-seconds'))).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: '暂停演示', exact: true }).click()
  const paused = await host.getAttribute('data-seconds')
  await page.waitForTimeout(300)
  expect(await host.getAttribute('data-seconds')).toBe(paused)
  await page.getByRole('button', { name: /商品目录/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await host.getAttribute('data-seconds')).toBe(paused)
  report.checks.push('play, pause, catalog preserves pose')
  await page.getByRole('button', { name: '回到开始', exact: true }).click()
  await page.mouse.move(720, 400)
  await page.mouse.down()
  await page.mouse.move(950, 550)
  await page.mouse.up()
  expect((await identity()).camera).toEqual(first.camera)
  report.checks.push('free orbit absent')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${output}/mobile.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await expect(page.getByRole('button', { name: /商品目录/ })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 844 })
  await page.waitForTimeout(350)
  await expect(page.getByRole('button', { name: /商品目录/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: `${output}/mobile-320.png` })
  await page.getByRole('button', { name: /商品目录/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByRole('button', { name: '播放演示', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '展开', exact: true }).click()
  expect(Number(await host.getAttribute('data-seconds'))).toBeCloseTo(11.75, 2)
  report.checks.push('390px/320px compatibility and catalog exit, reduced-motion chapter controls')
  expect(report.errors).toEqual([])
  expect(report.external).toEqual([])
  await writeFile(`${output}/runtime.json`, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({ checks: report.checks, errors: report.errors, source: first }, null, 2),
  )
} catch (error) {
  report.error = String(error)
  await writeFile(`${output}/runtime.json`, JSON.stringify(report, null, 2))
  throw error
} finally {
  await browser.close()
}
