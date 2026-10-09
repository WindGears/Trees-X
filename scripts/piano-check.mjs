/* global fetch, URL, TextEncoder */
import { chromium, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const fixture = process.env.PIANO_FIXTURE === '1'
const output = process.env.PIANO_CHECK_OUTPUT || 'artifacts/piano-migration/runtime'
const product = JSON.parse(
  await readFile('server/src/main/resources/presentations/piano-kimi-v1.json', 'utf8'),
)
const rig = JSON.parse(await readFile('public/models/bundles/kimi-piano/v1/rig.json', 'utf8'))
const chapters = [
  '整机',
  '剖切',
  '键盘',
  '击弦机构',
  '弦列与铁板',
  '音板与弦桥',
  '制音器与踏板',
  '全部平铺',
]
const report = { passed: false, fixture, checks: [], errors: [], requests: [], states: {} }
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  if (fixture)
    await context.route('**/api/v1/products/piano-cfx', (route) => route.fulfill({ json: product }))
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  page.on('request', (request) => report.requests.push(request.url()))

  const ready = async (slug) => {
    await expect(page.locator('.workbench')).toHaveAttribute('data-slug', slug)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 120000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    await page.evaluate(() => {
      let component = document.querySelector('canvas').__vueParentComponent
      let scene, motion
      while (component) {
        const values = Reflect.ownKeys(component.provides ?? {}).map((k) => component.provides[k])
        scene ??= component.exposed?.context ?? values.find((v) => v?.scene?.value?.isScene)
        motion ??= values.find((v) => v?.states?.value && typeof v.snapshot === 'function')
        component = component.parent
      }
      if (!scene || !motion) throw new Error('Actual Three context or motion session unavailable')
      window.__pianoScene = scene
      window.__pianoMotion = motion
    })
    expect(
      await page.evaluate(() =>
        window.__pianoScene.scene.value.children
          .filter((node) => node.userData.workbenchProduct)
          .map((node) => node.userData.workbenchProduct),
      ),
    ).toEqual([slug])
  }
  const state = () =>
    page.evaluate(async () => {
      const root = window.__pianoScene.scene.value.children.find(
        (node) => node.userData.workbenchProduct,
      )
      const poses = [],
        names = [],
        morphs = []
      root.traverse((node) => {
        if (/^piano-part-\d{3}$/.test(node.name)) names.push(node.name)
        const materials = node.material
          ? Array.isArray(node.material)
            ? node.material
            : [node.material]
          : []
        poses.push([
          node.name,
          node.visible,
          ...node.position.toArray(),
          ...node.quaternion.toArray(),
          ...node.scale.toArray(),
          ...(node.morphTargetInfluences ?? []),
          ...materials.map((material) => material.opacity),
        ])
        if (node.morphTargetInfluences?.length)
          morphs.push({ node: node.name, values: [...node.morphTargetInfluences] })
      })
      const digest = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(poses)),
      )
      const camera = window.__pianoScene.camera.activeCamera.value
      const motion = window.__pianoMotion.states.value['sound-path']
      return {
        source: root.userData.sourceKind,
        adapter: root.userData.adapter,
        partCount: root.userData.parts,
        semanticParts: names.sort(),
        poseDigest: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join(''),
        nodeCount: poses.length,
        morphs,
        camera: [...camera.position.toArray(), ...camera.quaternion.toArray()],
        motion: {
          progress: motion?.progress,
          target: motion?.target,
          playing: motion?.playing,
        },
        sameCanvas: document.querySelector('canvas') === window.__pianoCanvas,
        sameRenderer: window.__pianoScene.renderer.instance === window.__pianoRenderer,
      }
    })
  const save = async (name, value) => {
    const snapshot = value ?? (await state())
    report.states[name] = snapshot
    await writeFile(`${output}/${name}.json`, JSON.stringify(snapshot, null, 2) + '\n')
    return snapshot
  }
  const controls = () => page.locator('.wb-piano-motion')
  const chapter = (label) => controls().getByRole('button', { name: label, exact: true })
  const settled = async (label) => {
    await expect(chapter(label)).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
    await expect(controls().getByRole('button', { name: '继续', exact: true })).toBeVisible()
    return state()
  }
  const stable = async () => {
    await expect(controls().getByRole('button', { name: '继续', exact: true })).toBeVisible()
    const paused = await state()
    expect(paused.motion.playing).toBe(false)
    await page.waitForTimeout(350)
    expect((await state()).poseDigest).toBe(paused.poseDigest)
    return paused
  }
  const openActions = async () => {
    await page.getByRole('button', { name: '结构与动作', exact: true }).click()
    await expect(controls()).toBeVisible()
  }
  const choosePiano = async () => {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(product.name) })
      .click()
    await ready(product.slug)
  }

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await ready('typewriter-study')
  const catalog = await (await fetch(base + '/api/v1/products')).json()
  await page.getByRole('button', { name: '商品目录', exact: true }).click()
  await expect(page.locator('.wb-catalog-list button')).toHaveCount(catalog.length)
  if (!fixture) {
    expect(catalog.map((entry) => entry.slug).sort()).toEqual([
      'piano-cfx',
      'reventon',
      'typewriter-study',
    ])
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: new RegExp(product.name) })
      .click()
    await ready(product.slug)
    report.checks.push(
      'Real API catalog has 3 listed products; homepage remains typewriter; piano opens from catalog',
    )
  } else {
    await page.goto(base + '/?product=piano-cfx', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await ready(product.slug)
    report.checks.push(
      'Explicit piano detail fixture; real homepage remains typewriter; live catalog still readable',
    )
  }
  await page.evaluate(() => {
    window.__pianoCanvas = document.querySelector('canvas')
    window.__pianoRenderer = window.__pianoScene.renderer.instance
  })
  const initial = await save('initial')
  expect(initial.source).toBe('glb')
  expect(initial.adapter).toBe('piano-v1')
  expect(initial.partCount).toBe(823)
  expect(initial.semanticParts).toEqual(rig.parts.map((part) => part.node).sort())
  expect(initial.morphs.length).toBeGreaterThan(0)
  expect(initial.morphs.every((morph) => morph.values.every((value) => value === 0))).toBe(true)
  report.checks.push(
    'Actual recovered GLB has all 823 semantic part nodes and real morph surfaces, one Canvas',
  )

  await openActions()
  await expect(controls().locator('input[type=range]')).toHaveCount(0)
  await expect(controls().locator('.wb-piano-chapters button')).toHaveCount(8)
  await expect(controls().locator('.wb-piano-chapters button')).toHaveText(chapters)
  await chapter('全部平铺').click()
  await page.waitForTimeout(650)
  await controls().getByRole('button', { name: '暂停', exact: true }).click()
  const paused = await save('paused', await stable())
  expect(paused.poseDigest).not.toBe(initial.poseDigest)
  expect(paused.motion.progress).toBeGreaterThan(0)
  expect(paused.motion.progress).toBeLessThan(1)
  expect(paused.camera).toEqual(initial.camera)
  await controls().getByRole('button', { name: '继续', exact: true }).click()
  const flat = await save('flat', await settled('全部平铺'))
  expect(flat.poseDigest).not.toBe(initial.poseDigest)
  expect(flat.camera).toEqual(initial.camera)
  expect(flat.morphs.length).toBe(initial.morphs.length)
  expect(
    flat.morphs.every((morph) => morph.values.every((value) => Math.abs(value - 1) < 0.00001)),
  ).toBe(true)
  report.checks.push(
    'Eight named chapters with no slider; mid-route pause/resume holds actual structure; flat morph reaches 1; camera stays independent',
  )

  let previous = flat
  for (let index = 6; index >= 0; index--) {
    await chapter(chapters[index]).click()
    const value = await save(`chapter-${index}`, await settled(chapters[index]))
    expect(value.motion.progress).toBeCloseTo(index / 7, 5)
    expect(value.poseDigest).not.toBe(previous.poseDigest)
    expect(value.camera).toEqual(initial.camera)
    previous = value
  }
  expect(previous.poseDigest).toBe(initial.poseDigest)
  await chapter('键盘').click()
  await settled('键盘')
  await controls().getByRole('button', { name: '键盘取景', exact: true }).click()
  await page.waitForTimeout(800)
  const framed = await state()
  expect(framed.camera).not.toEqual(initial.camera)
  await controls().getByRole('button', { name: '复原动作', exact: true }).click()
  const reset = await save('reset', await settled('整机'))
  expect(reset.poseDigest).toBe(initial.poseDigest)
  expect(reset.camera).toEqual(framed.camera)
  report.checks.push(
    'All 8 chapters reached in reverse without camera motion; explicit chapter framing changes camera; action reset restores every pose and morph',
  )

  await page.getByRole('button', { name: '还原商品', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await expect(page.locator('.wb-hotspot')).toHaveCount(8)
  await page.getByLabel('查找部件', { exact: true }).fill('piano-part-000')
  await expect(page.locator('.wb-part-list button')).toHaveCount(1)
  await page.getByLabel('查找部件', { exact: true }).fill('铸铁板')
  await expect(page.locator('.wb-part-list button')).toHaveCount(1)
  await page.locator('.wb-part-list button').click()
  await expect(page.locator('.wb-part-copy h3')).toHaveText('铸铁板')
  const plateId = product.presentation.hotspots.find((part) => part.name === '铸铁板').id
  const plateLabel = page.locator('.wb-hotspot[data-part="' + plateId + '"]')
  await expect(plateLabel).toBeVisible()
  await expect(plateLabel).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByLabel('查找部件', { exact: true }).fill('')
  await page.getByLabel('部件组', { exact: true }).selectOption('音板')
  await expect(page.locator('.wb-part-list')).toContainText('音板')
  await page.getByLabel('部件组', { exact: true }).selectOption('')
  await page.getByRole('button', { name: '查看全部 823 个部件', exact: true }).click()
  await expect(page.locator('.wb-part-list button')).toHaveCount(40)
  await page.getByRole('button', { name: '显示更多部件（40 / 823）', exact: true }).click()
  await expect(page.locator('.wb-part-list button')).toHaveCount(80)
  const hotspot = page.locator('.wb-hotspot').filter({ hasText: '键盘框架' })
  await expect(hotspot).toBeVisible()
  await hotspot.click()
  await expect(page.locator('.wb-part-copy h3')).toHaveText('键盘框架')
  await page.getByRole('button', { name: '返回全景', exact: true }).click()
  report.checks.push(
    'Real semantic query, grouping and 823-part pagination; selected hotspot follows focus; actual hotspot button opens the matching detail',
  )

  expect(product.presentation.guide).toHaveLength(9)
  await page.getByRole('button', { name: '导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  for (let index = 0; index < 9; index++) {
    await expect(page.locator('.wb-guide-count')).toHaveText(`${index + 1} / 9`)
    await expect
      .poll(async () => (await state()).motion.progress)
      .toBeCloseTo(index < 8 ? index / 7 : 0, 8)
    if (index < 8) await page.getByRole('button', { name: '下一步', exact: true }).click()
  }
  expect((await state()).poseDigest).toBe(initial.poseDigest)
  await page.getByRole('button', { name: '完成导览', exact: true }).click()
  await page.getByRole('button', { name: '开始导览', exact: true }).click()
  await page.getByRole('group', { name: '商品展示区', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: '开始导览', exact: true })).toBeVisible()
  report.checks.push(
    'All 9 guide steps reach their real structure checkpoints; manual keyboard observation exits guide',
  )

  await openActions()
  await chapter('全部平铺').click()
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await save('hidden', await stable())
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect((await stable()).poseDigest).toBe(hidden.poseDigest)
  await page.evaluate(() => {
    window.__pianoLoss = window.__pianoScene.renderer.instance
      .getContext()
      .getExtension('WEBGL_lose_context')
    if (!window.__pianoLoss) throw new Error('Actual WebGL context-loss extension unavailable')
    window.__pianoLoss.loseContext()
  })
  await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'error')
  await page.waitForTimeout(250)
  await page.evaluate(() => window.__pianoLoss.restoreContext())
  await ready(product.slug)
  const recovered = await save('recovered', await stable())
  expect(recovered.poseDigest).toBe(hidden.poseDigest)
  expect(recovered.motion.progress).toBe(hidden.motion.progress)
  expect(recovered.sameCanvas).toBe(true)
  expect(recovered.sameRenderer).toBe(true)
  report.checks.push(
    'Synthetic hidden-page pause retains structure; real WebGL loss and recovery restores the same checkpoint paused on the same Canvas and renderer',
  )

  if (!fixture) {
    await page.getByRole('button', { name: '商品目录', exact: true }).click()
    await page
      .locator('.wb-catalog-list')
      .getByRole('button', { name: /机械打字机/ })
      .click()
    await ready('typewriter-study')
    await choosePiano()
    const revisited = await save('revisited')
    expect(revisited.poseDigest).toBe(initial.poseDigest)
    expect(revisited.sameCanvas).toBe(true)
    expect(revisited.sameRenderer).toBe(true)
    report.checks.push(
      'Live catalog switches piano → typewriter → piano with one existing Canvas and renderer, resetting the product checkpoint',
    )
  }
  expect(
    report.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => new URL(url).origin === new URL(base).origin),
  ).toBe(true)
  expect(report.requests.some((url) => url.endsWith('/kimi-piano/v1/model.glb'))).toBe(true)
  expect(report.errors).toEqual([])
  report.checks.push(
    'All browser requests stay same-origin; actual GLB fetched; no page or console errors',
  )
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({ passed: report.passed, fixture, checks: report.checks, errors: report.errors }),
)
