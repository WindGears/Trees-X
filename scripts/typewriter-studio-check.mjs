/* global URL, performance */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  readProducts,
  ready,
  bridge,
  sceneSnapshot,
  compactSnapshot,
  choose,
  openPanel,
} from './demo/browser-check.mjs'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5183'
const output = process.env.STUDIO_CHECK_OUTPUT || 'artifacts/typewriter-studio/check'
const studioName = 'Trees X / product studio'
const reflectionName = 'Trees X / studio reflection'
await mkdir(output, { recursive: true })
const { products } = await readProducts(base)
const typewriter = products.find(({ product }) => product.slug === 'typewriter-study')
const piano = products.find(({ product }) => product.slug === 'piano-cfx')
const report = {
  passed: false,
  checks: [],
  captures: [],
  states: {},
  targetPixels: {},
  lifecycle: [],
  errors: [],
  requests: [],
}
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) report.requests.push(request.url())
  })
  const actualStudio = async () => {
    await bridge(page)
    return page.evaluate(
      ({ studioName, reflectionName }) => {
        const scene = window.__demo.scene.scene.value,
          root = scene.getObjectByName(studioName),
          reflections = [],
          studios = []
        scene.traverse((node) => {
          if (node.name === studioName) studios.push(node.uuid)
          if (node.name === reflectionName) reflections.push(node.uuid)
        })
        const reflection = scene.getObjectByName(reflectionName),
          target = reflection?.getRenderTarget?.()
        return {
          studios,
          reflections,
          parent: root?.parent?.type,
          flagged: root?.userData.studio,
          meshes: root ? root.children.filter((node) => node.isMesh).length : 0,
          hasTarget: Boolean(target?.isWebGLRenderTarget),
          target: target
            ? { width: target.width, height: target.height, type: target.texture.type }
            : null,
          environment: Boolean(scene.environment),
          renderer: { ...window.__demo.scene.renderer.instance.info.memory },
        }
      },
      { studioName, reflectionName },
    )
  }
  const checkStudio = async (name) => {
    const value = await actualStudio()
    expect(value.studios).toHaveLength(1)
    expect(value.reflections).toHaveLength(1)
    expect(value.flagged).toBe(true)
    expect(value.meshes).toBeGreaterThan(0)
    expect(value.hasTarget).toBe(true)
    expect(value.environment).toBe(true)
    expect(value.target.width).toBeGreaterThan(0)
    expect(value.target.height).toBeGreaterThan(0)
    report.states[name] = value
    return value
  }
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(1, 1)
    await page.waitForTimeout(180)
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    report.captures.push(name)
  }
  const closePanel = async () => {
    const button = page.getByRole('button', { name: '收起面板', exact: true })
    if (await button.isVisible()) await button.click()
    await expect(page.locator('.wb-panel:not(.wb-panel-catalog)')).toHaveCount(0)
  }
  const openActions = () => openPanel(page, '结构与动作', '.wb-layout-motion')
  const restore = async () => {
    await openActions()
    await page.getByRole('button', { name: '复原动作', exact: true }).click()
    await expect(page.getByRole('button', { name: '合拢整机', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: '复位视角', exact: true }).click()
    await closePanel()
    await page.waitForTimeout(850)
  }
  // This uses the existing Vue bridge only inside this disposable test browser.
  // No production collector, debug property, extra WebGL renderer, or API write is installed.
  const reflectionPixels = async (name) => {
    const value = await page.evaluate(async (reflectionName) => {
      const { scene } = window.__demo,
        renderer = scene.renderer.instance,
        reflection = scene.scene.value.getObjectByName(reflectionName),
        target = reflection.getRenderTarget(),
        length = target.width * target.height * 4,
        type = target.texture.type,
        pixels =
          type === 1015
            ? new Float32Array(length)
            : type === 1016
              ? new Uint16Array(length)
              : new Uint8Array(length)
      // Ordinary scene render runs the Reflector's actual onBeforeRender; the target
      // therefore contains the real current camera and the current instanced parts.
      renderer.render(scene.scene.value, scene.camera.activeCamera.value)
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels)
      const fromHalf = (value) => {
        const sign = value & 0x8000 ? -1 : 1,
          exponent = (value >> 10) & 0x1f,
          mantissa = value & 0x3ff
        if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024)
        if (exponent === 31) return mantissa ? NaN : sign * Infinity
        return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
      }
      const component = (offset) =>
        type === 1015
          ? pixels[offset]
          : type === 1016
            ? fromHalf(pixels[offset])
            : pixels[offset] / 255
      let minimum = Infinity,
        maximum = -Infinity,
        litPixels = 0,
        invalidComponents = 0
      const levels = new Set()
      for (let index = 0; index < length; index += 4) {
        let brightness = 0
        for (let channel = 0; channel < 3; channel++) {
          const value = component(index + channel)
          if (!Number.isFinite(value)) invalidComponents++
          else {
            minimum = Math.min(minimum, value)
            maximum = Math.max(maximum, value)
            brightness += value
            levels.add(Math.round(value * 1024))
          }
        }
        if (brightness > 0.003) litPixels++
      }
      const size = 256,
        preview = document.createElement('canvas')
      preview.width = size
      preview.height = size
      const context = preview.getContext('2d'),
        image = context.createImageData(size, size)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const input =
            (Math.floor(((size - 1 - y) * target.height) / size) * target.width +
              Math.floor((x * target.width) / size)) *
            4
          const output = (y * size + x) * 4
          for (let channel = 0; channel < 3; channel++)
            image.data[output + channel] = Math.round(
              255 * Math.max(0, Math.min(1, component(input + channel))),
            )
          image.data[output + 3] = 255
        }
      context.putImageData(image, 0, 0)
      const digest = Array.from(
        new Uint8Array(await window.crypto.subtle.digest('SHA-256', pixels.buffer)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('')
      return {
        digest,
        width: target.width,
        height: target.height,
        minimum,
        maximum,
        litPixels,
        levels: levels.size,
        invalidComponents,
        preview: preview.toDataURL('image/png'),
      }
    }, reflectionName)
    const { preview, ...evidence } = value
    await writeFile(`${output}/${name}-target.png`, Buffer.from(preview.split(',')[1], 'base64'))
    expect(evidence.invalidComponents).toBe(0)
    expect(evidence.litPixels).toBeGreaterThan(100)
    expect(evidence.maximum - evidence.minimum).toBeGreaterThan(0.01)
    expect(evidence.levels).toBeGreaterThan(16)
    report.targetPixels[name] = evidence
    return evidence
  }
  const watchStudioResources = () =>
    page.evaluate((studioName) => {
      const scene = window.__demo.scene.scene.value,
        root = scene.getObjectByName(studioName),
        ownedNodes = [
          root,
          scene.getObjectByName('Trees X / studio reflection'),
          scene.getObjectByName('Trees X / studio contact shadow'),
        ].filter(Boolean),
        registry = (window.__studioResources ??= []),
        entry = {
          id: root.uuid,
          nodes: ownedNodes.map((node) => new WeakRef(node)),
          resources: { geometry: 0, material: 0, texture: 0, target: 0 },
          disposed: { geometry: 0, material: 0, texture: 0, target: 0 },
        },
        seen = new Set()
      const track = (resource, kind) => {
        if (!resource || seen.has(resource)) return
        seen.add(resource)
        entry.resources[kind]++
        resource.addEventListener('dispose', () => entry.disposed[kind]++)
      }
      for (const ownedNode of ownedNodes)
        ownedNode.traverse((node) => {
          track(node.geometry, 'geometry')
          const materials = node.material
            ? Array.isArray(node.material)
              ? node.material
              : [node.material]
            : []
          for (const material of materials) {
            track(material, 'material')
            // The contact-shadow map is the attachment of its privately owned
            // target. It is released through target.dispose(), not Texture.dispose().
            if (node.name !== 'Trees X / studio contact shadow')
              for (const value of Object.values(material))
                if (value?.isTexture) track(value, 'texture')
          }
          const target = node.getRenderTarget?.()
          if (target) {
            // A render target owns its GPU attachments: target.dispose() is the
            // release boundary; the attachment Texture need not emit dispose too.
            track(target, 'target')
          }
        })
      registry.push(entry)
      return { id: entry.id, resources: entry.resources }
    }, studioName)
  const disposedStudios = () =>
    page.evaluate(() =>
      (window.__studioResources ?? []).map((entry) => ({
        id: entry.id,
        detached: entry.nodes.every((node) => !node.deref()?.parent),
        resources: entry.resources,
        disposed: entry.disposed,
      })),
    )

  console.log('Studio check: loading real typewriter')
  await page.goto(`${base}/?product=typewriter-study`)
  const initial = await ready(page, typewriter, { remember: true, timeout: 90000 })
  console.log('Studio check: first frame ready')
  expect(initial.semanticParts).toBe(572)
  report.states.initialProduct = compactSnapshot(initial)
  await checkStudio('initialStudio')
  await watchStudioResources()
  await capture('whole-1440')
  const wholeTarget = await reflectionPixels('whole')
  report.checks.push(
    'Real 572-part GLB, one Canvas/renderer, one physical studio and non-uniform live reflection target',
  )

  // Match the prior-build screenshots exactly: same real semantic parts and visitor focus commands.
  const paint = typewriter.product.presentation.hotspots.find((part) => part.id === 'part-095')
  const metal = typewriter.product.presentation.hotspots.find((part) => part.id === 'part-000')
  for (const [name, part] of [
    ['paint-closeup', paint],
    ['metal-closeup', metal],
  ]) {
    await openPanel(page, '细节', '.wb-parts-filter')
    await page.locator('#wb-parts-query').fill(part.id)
    await page.locator('.wb-part-list button').first().click()
    await page.waitForTimeout(850)
    await expect(page.locator('.wb-part-copy h3')).toHaveText(part.name)
    await capture(name)
    report.states[name] = compactSnapshot(await sceneSnapshot(page, typewriter))
  }
  await restore()
  const restoredWhole = await reflectionPixels('restored-whole')
  expect(restoredWhole.digest).toBe(wholeTarget.digest)
  report.checks.push(
    'Real paint and metal hotspot closeups; action/overview restore deterministically returns reflection pixels',
  )

  await openActions()
  await page.getByRole('button', { name: '击发 A 键', exact: true }).click()
  await page.waitForTimeout(85)
  const strike = await sceneSnapshot(page, typewriter)
  expect(strike.poseDigest).not.toBe(initial.poseDigest)
  report.states.strikePeak = compactSnapshot(strike)
  await page.screenshot({ path: `${output}/a-strike-peak.png`, fullPage: true })
  report.captures.push('a-strike-peak')
  await expect
    .poll(async () => (await sceneSnapshot(page, typewriter)).poseDigest)
    .toBe(initial.poseDigest)
  report.checks.push(
    'A key linkage changes real part poses and returns to rest; intermediate screenshot records actual geometry',
  )
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => /\/gsap\.js(?:\?|$)/.test(entry.name))?.name
    if (!url) throw new Error('Already loaded GSAP module URL unavailable')
    const loaded = await import(url)
    window.__studioGsap = loaded.gsap ?? loaded.default
  })
  await page.getByRole('button', { name: '击发 A 键', exact: true }).click()
  await page.evaluate(() => {
    const tween = window.__studioGsap.globalTimeline
      .getChildren(true, true, false)
      .find((entry) => entry.targets().some((target) => Object.hasOwn(target, 'press-key')))
    if (!tween) throw new Error('UI-created A strike tween unavailable')
    window.__studioStrike = tween.pause()
  })
  for (const view of ['side', 'front']) {
    await page.getByLabel('观察视角', { exact: true }).selectOption(view)
    await page.waitForTimeout(700)
    for (const progress of [0, 0.5, 1]) {
      const actual = await page.evaluate((progress) => {
        const tween = window.__studioStrike
        tween.totalTime(progress * tween.duration(), false).pause()
        return tween.targets()[0]['press-key']
      }, progress)
      expect(Math.abs(actual - progress)).toBeLessThan(0.0001)
      report.states[`strike-${view}-${progress}`] = compactSnapshot(
        await sceneSnapshot(page, typewriter),
      )
      await capture(`strike-${view}-${progress}`)
    }
  }
  for (const [name, id] of [
    ['key-closeup', 'part-070'],
    ['typebar-closeup', 'part-023'],
  ]) {
    await openPanel(page, '细节', '.wb-parts-filter')
    await page.locator('#wb-parts-query').fill(id)
    await page.locator('.wb-part-list button').first().click()
    await page.waitForTimeout(700)
    for (const progress of [0, 0.5, 1]) {
      const actual = await page.evaluate((progress) => {
        const tween = window.__studioStrike
        tween.totalTime(progress * tween.duration(), false).pause()
        return tween.targets()[0]['press-key']
      }, progress)
      expect(Math.abs(actual - progress)).toBeLessThan(0.0001)
      const detail = await sceneSnapshot(page, typewriter)
      expect(detail.selectedPart).toBe(id)
      report.states[`strike-${name}-${progress}`] = compactSnapshot(detail)
      await capture(`strike-${name}-${progress}`)
    }
  }
  await page.evaluate(() =>
    window.__studioStrike.totalTime(window.__studioStrike.totalDuration(), false),
  )
  await restore()
  await openActions()
  report.checks.push(
    'UI-created strike is deterministically held at 0/0.5/1 from side/front and actual key/typebar hotspot closeups for geometry inspection, then restored',
  )
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  await expect(page.getByRole('button', { name: '分层展开', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 15000 },
  )
  const layered = await sceneSnapshot(page, typewriter)
  expect(layered.poseDigest).not.toBe(initial.poseDigest)
  await closePanel()
  await page.waitForTimeout(400)
  const layersTarget = await reflectionPixels('layers')
  expect(layersTarget.digest).not.toBe(wholeTarget.digest)
  await openActions()
  await page.getByRole('button', { name: '展开全景', exact: true }).click()
  await page.waitForTimeout(850)
  await capture('layers-panel')
  await closePanel()
  await capture('layers-clear')
  await openActions()
  await page.getByRole('button', { name: '平铺部件', exact: true }).click()
  await expect(page.getByRole('button', { name: '平铺部件', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 15000 },
  )
  await page.getByRole('button', { name: '平铺俯视', exact: true }).click()
  await page.waitForTimeout(850)
  await closePanel()
  await capture('flat-clear')
  report.states.flat = compactSnapshot(await sceneSnapshot(page, typewriter))
  report.checks.push(
    'Live reflected content changes with actual structure pose; layers/flat and thin semantic labels remain usable',
  )

  await restore()
  await openPanel(page, '外观', '.wb-finishes')
  await page.getByRole('button', { name: '象牙白漆面', exact: true }).click()
  await capture('ivory-panel')
  const ivory = await reflectionPixels('ivory')
  expect(ivory.digest).not.toBe(wholeTarget.digest)
  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await closePanel()
  await page.waitForTimeout(850)
  expect((await reflectionPixels('reset')).digest).toBe(wholeTarget.digest)
  expect((await sceneSnapshot(page, typewriter)).poseDigest).toBe(initial.poseDigest)
  report.checks.push(
    'Appearance updates reflected product; complete restore returns original geometry pose and target pixels',
  )

  // One bounded first-pass screenshot batch. Later confirmations use a different output directory.
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    await capture(`whole-${width}`)
    await checkStudio(`viewport-${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openActions()
  await page.getByRole('button', { name: '分层展开', exact: true }).click()
  await expect(page.getByRole('button', { name: '分层展开', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await closePanel()
  await capture('reduced-layers')
  report.checks.push(
    'Three desktop and two mobile sizes retain real studio; reduced-motion structure reaches final state',
  )

  const beforeLoss = await sceneSnapshot(page, typewriter)
  await page.evaluate(() => {
    window.__studioLoss = window.__demo.renderer.getContext().getExtension('WEBGL_lose_context')
    if (!window.__studioLoss) throw new Error('Real context-loss extension unavailable')
    window.__studioLoss.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__studioLoss.restoreContext())
  await ready(page, typewriter)
  await checkStudio('restoredStudio')
  expect((await sceneSnapshot(page, typewriter)).poseDigest).toBe(beforeLoss.poseDigest)
  const disposedAfterLoss = await disposedStudios()
  for (const entry of disposedAfterLoss) {
    expect(entry.detached).toBe(true)
    expect(entry.disposed).toEqual(entry.resources)
  }
  await watchStudioResources()
  await reflectionPixels('context-restored')
  report.lifecycle.push(...disposedAfterLoss)
  report.checks.push(
    'Actual WebGL loss/recovery rebuilds one studio, disposes old studio resources exactly once, preserves structure on same renderer',
  )

  await choose(page, piano)
  await ready(page, piano)
  const absent = await actualStudio()
  expect(absent.studios).toEqual([])
  expect(absent.reflections).toEqual([])
  for (const entry of await disposedStudios()) {
    expect(entry.detached).toBe(true)
    expect(entry.disposed).toEqual(entry.resources)
  }
  await choose(page, typewriter)
  await ready(page, typewriter)
  await checkStudio('returnedStudio')
  await restore()
  report.states.returnedProduct = compactSnapshot(await sceneSnapshot(page, typewriter))
  expect(report.states.returnedProduct.poseDigest).toBe(initial.poseDigest)
  report.lifecycle = await disposedStudios()
  report.checks.push(
    'Switch to actual piano unloads the sample studio; return initializes one new studio without changing Canvas/renderer',
  )
  expect(report.requests.every((url) => new URL(url).origin === new URL(base).origin)).toBe(true)
  expect(report.errors).toEqual([])
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error)
  if (page) {
    report.failureState = await page
      .evaluate(() => ({
        status: document.querySelector('.workbench')?.dataset.status,
        phase: document.querySelector('.workbench')?.dataset.loadPhase,
        message: document.querySelector('.wb-stage-status')?.textContent,
        canvasCount: document.querySelectorAll('canvas').length,
      }))
      .catch((cause) => ({ unavailable: String(cause) }))
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
    console.error(
      JSON.stringify({
        failure: report.failure,
        state: report.failureState,
        errors: report.errors,
      }),
    )
  }
  throw error
} finally {
  await browser.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    checks: report.checks,
    captures: report.captures,
    errors: report.errors,
  }),
)
