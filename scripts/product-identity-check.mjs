/* global WebGL2RenderingContext */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5180'
const output = '.impeccable/review'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { errors: [], scenes: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.addInitScript(() => {
    window.__drawCount = 0
    for (const method of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
    ]) {
      const original = WebGL2RenderingContext.prototype[method]
      WebGL2RenderingContext.prototype[method] = function (...args) {
        window.__drawCount++
        return original.apply(this, args)
      }
    }
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  async function ready() {
    await expect(page.getByRole('button', { name: '正面', exact: true })).toBeEnabled({
      timeout: 40000,
    })
    await page.waitForTimeout(2700)
  }
  async function sceneIdentity() {
    return page.evaluate(() => {
      // Dev-only introspection is independent from the UI's selected product metadata.
      let component = document.querySelector('canvas')?.__vueParentComponent
      while (component) {
        const context =
          component.exposed?.context ??
          Reflect.ownKeys(component.provides ?? {})
            .map((key) => component.provides[key])
            .find((value) => value?.scene?.value?.isScene)
        if (context?.scene?.value) {
          const names = []
          context.scene.value.traverse((object) => {
            if (object.isMesh && object.name && !object.name.endsWith('_Hologram'))
              names.push(object.name)
          })
          window.__identityContext = context
          return names.sort()
        }
        component = component.parent
      }
      return document.querySelector('.product-viewer').dataset.renderedMeshes.split('|').sort()
    })
  }
  await page.goto(`${base}/?product=potted-plant`)
  await ready()
  await page.evaluate(() => {
    window.__identityCanvas = document.querySelector('canvas')
  })
  report.scenes.push({ selected: 'potted-plant', meshes: await sceneIdentity() })
  await page.getByRole('button', { name: /商品目录/ }).click()
  await page.getByRole('button', { name: '展示复古游戏手柄', exact: true }).click()
  await ready()
  const switched = await sceneIdentity()
  report.render = await page.evaluate(() => ({
    frame: window.__drawCount,
    active: document.querySelector('.product-viewer').dataset.composerCount === '1',
  }))
  await page.waitForTimeout(1000)
  report.renderAfter = await page.evaluate(() => ({
    frame: window.__drawCount,
    active: document.querySelector('.product-viewer').dataset.composerCount === '1',
  }))
  report.scenes.push({ selected: 'gamepad', meshes: switched })
  await page.screenshot({ path: `${output}/identity-switched.png` })
  expect(
    await page.evaluate(() => document.querySelector('canvas') === window.__identityCanvas),
  ).toBe(true)
  await page.reload()
  await ready()
  const direct = await sceneIdentity()
  report.scenes.push({ selected: 'gamepad-direct', meshes: direct })
  await page.screenshot({ path: `${output}/identity-direct.png` })
  await writeFile(`${output}/product-identity-results.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  expect(
    report.renderAfter.frame,
    'cinematic render must resume after closing the catalog',
  ).toBeGreaterThan(report.render.frame)
  expect(
    switched,
    'switched scene must contain the same actual meshes as direct navigation',
  ).toEqual(direct)
  expect(switched?.some((name) => name.includes('gamepad'))).toBe(true)
  expect(switched?.some((name) => name.includes('potted'))).toBe(false)
  expect(report.errors).toEqual([])
} finally {
  await browser.close()
}
