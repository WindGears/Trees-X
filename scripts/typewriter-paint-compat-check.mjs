/* global URL */
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { bridge } from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = 'artifacts/typewriter-paint/compat'
const candidate = JSON.parse(await readFile('src/lib/workbench/typewriterPaintBundle.json', 'utf8'))
const report = {
  passed: false,
  backend: 'webgl',
  checks: [],
  errors: [],
  startedAt: new Date().toISOString(),
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text())
})
try {
  for (const asset of [null, 'paint-study']) {
    const url = new URL('/?product=typewriter-study&renderPipeline=webgl', base)
    if (asset) url.searchParams.set('typewriterAsset', asset)
    await page.goto(url.href)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 240000,
    })
    await bridge(page, true)
    const actual = await page.evaluate(() => {
      const demo = window.__demo
      const root = demo.scene.scene.value.children.find((node) => node.userData.workbenchProduct)
      const materials = new Map()
      let parts = 0
      root.traverse((node) => {
        if (Number.isInteger(node.userData.partId)) parts++
        for (const material of node.material
          ? Array.isArray(node.material)
            ? node.material
            : [node.material]
          : [])
          materials.set(material.name, material)
      })
      return {
        version: root.userData.bundleVersion,
        hash: root.userData.bundleSha256,
        parts,
        webgl: demo.renderer.isWebGLRenderer,
        paint: [...materials.values()]
          .filter((m) => ['enamel', 'shellGloss', 'shellRim'].includes(m.name))
          .map((m) => ({
            name: m.name,
            coat: !!m.clearcoatRoughnessMap,
            linear: m.normalMap?.colorSpace,
          })),
      }
    })
    expect(actual.parts).toBe(572)
    expect(actual.webgl).toBe(true)
    expect(actual.version).toBe(asset ? candidate.version : 1)
    if (asset) {
      expect(actual.hash).toBe(candidate.sha256)
      expect(actual.paint).toHaveLength(3)
      for (const material of actual.paint)
        expect(material).toMatchObject({ coat: true, linear: '' })
    }
    report.checks.push({ asset: asset || 'default', actual })
  }
  for (const [width, height] of [
    [1280, 720],
    [1440, 1000],
    [1920, 1080],
    [390, 844],
    [320, 760],
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(600)
    await expect(page.locator('canvas')).toHaveCount(1)
    const actual = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      sameCanvas: document.querySelector('canvas') === window.__demo.canvas,
      sameRenderer: window.__demo.scene.renderer.instance === window.__demo.renderer,
    }))
    expect(actual.sameCanvas && actual.sameRenderer).toBe(true)
    expect(actual.scrollWidth).toBeLessThanOrEqual(actual.width + 1)
    await page.screenshot({ path: `${output}/${width}x${height}.png` })
    report.checks.push({ viewport: { width, height }, actual })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('canvas')).toHaveCount(1)
  report.reducedMotion = { smokeOnly: true, samePage: true }
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = error.stack || String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      failure: report.failure,
      output,
    }),
  )
}
