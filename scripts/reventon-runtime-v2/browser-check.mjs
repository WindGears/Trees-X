/* global document, window, requestAnimationFrame */
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { bridge } from '../demo/browser-check.mjs'
import { digest, readGlb, relativeResource } from '../asset-package.mjs'
import { createFixtureHttpSession } from './fixture-http.mjs'

const fixturePrefix = 'artifacts/car-runtime-v2/material-comparison/'
const viewport = { width: 1440, height: 1000 }
const contentTypes = {
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.exr': 'image/x-exr',
  '.json': 'application/json',
}

export function fixturePath(root, path) {
  relativeResource(path)
  assert.ok(path.startsWith(fixturePrefix), 'Only ignored material-comparison files are allowed')
  return resolve(root, path)
}

async function readFixture(root, path, expected) {
  const filename = fixturePath(root, path),
    actual = await realpath(filename),
    actualRelative = relative(await realpath(root), actual).replaceAll('\\', '/')
  assert.ok(actualRelative.startsWith(fixturePrefix), 'Fixture symlink escapes ignored directory')
  const bytes = await readFile(actual)
  if (expected?.bytes != null)
    assert.equal(bytes.length, expected.bytes, 'Fixture byte length ' + path)
  if (expected?.sha256) assert.equal(digest(bytes), expected.sha256, 'Fixture digest ' + path)
  return bytes
}

export async function prepareComparisonCase(root, group, variant) {
  const manifestBytes = await readFixture(root, variant.manifest, {
      sha256: variant.manifestSha256,
    }),
    manifest = JSON.parse(manifestBytes),
    product = JSON.parse(await readFixture(root, variant.product)),
    base = dirname(variant.manifest).replaceAll('\\', '/'),
    record = JSON.parse(await readFixture(root, base + '/production-record.json')),
    files = new Map()
  assert.equal(manifest.fixture, true)
  assert.equal(product.fixture, true)
  assert.equal(record.fixture, true)
  assert.equal(record.group, group.id)
  assert.equal(record.variant, variant.variant)
  assert.equal(record.validation.errors, 0)
  assert.equal(record.validation.truncated, false)
  assert.equal(product.slug, 'reventon')
  assert.equal(product.presentation.source.adapter, 'reventon-v1')
  assert.equal(product.presentation.source.bundle.id, manifest.id)
  assert.equal(product.presentation.source.bundle.sha256, variant.manifestSha256)
  assert.equal(product.presentation.source.bundle.manifest, '/' + variant.manifest)
  assert.equal(manifest.entry, 'model.glb')
  files.set('/' + variant.manifest, {
    path: variant.manifest,
    bytes: manifestBytes.length,
    sha256: digest(manifestBytes),
    type: 'application/json',
  })
  let model
  for (const file of manifest.files) {
    const path = base + '/' + relativeResource(file.path),
      bytes = await readFixture(root, path, file),
      extension = /\.[a-z0-9]+$/i.exec(file.path)?.[0].toLowerCase()
    assert.ok(!files.has('/' + path), 'Duplicate fixture resource')
    files.set('/' + path, {
      path,
      bytes: file.bytes,
      sha256: file.sha256,
      type: contentTypes[extension] ?? 'application/octet-stream',
    })
    if (file.path === manifest.entry) model = readGlb(bytes)
  }
  assert.ok(model, 'Registered GLB entry required')
  assert.deepEqual(product.presentation.camera, variant.camera)
  assert.equal(record.geometryProof.binAndAccessorBytesIdentical, true)
  assert.equal(record.geometryProof.selectedTrianglePositionNormalTangentUvError, 0)
  return { group: group.id, variant: variant.variant, manifest, product, record, files }
}

export function fixtureRequest(origin, requestUrl, method, files) {
  const url = new URL(requestUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { action: 'continue' }
  if (url.origin !== origin)
    return { action: 'reject', reason: 'External request is outside same-origin fixture' }
  if (method !== 'GET')
    return { action: 'reject', reason: 'Read-only fixture rejects non-GET requests' }
  if (url.pathname === '/api/v1/products/reventon') return { action: 'product' }
  if (files.has(url.pathname)) return { action: 'file', file: files.get(url.pathname) }
  if (url.pathname.startsWith('/artifacts/') || url.pathname.startsWith('/models/'))
    return { action: 'reject', reason: 'Unregistered model/fixture resource' }
  return { action: 'continue' }
}

/** Runs in the disposable browser realm; exported for a CPU VNode/ref regression test. */
export function attachFixtureRuntime() {
  const seen = new Set()
  const diagnostics = []
  window.__carMaterialBridgeDiagnostics = diagnostics
  function visit(vnode) {
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
    seen.add(vnode)
    const current = vnode.component
    if (current) {
      // Tres creates a separate custom-renderer VNode tree for the scene.
      // WorkbenchStage only forwards lighting; its retained sceneHost ref is
      // the actual WorkbenchScene exposure containing the camera checkpoint.
      for (const [origin, source] of [
        ['exposed', current.exposed],
        ['refs.sceneHost', current.refs?.sceneHost],
      ]) {
        const exposed = source?.value ?? source,
          lighting = exposed?.realLighting?.value ?? exposed?.realLighting,
          checkpoint = exposed?.checkpoint?.value ?? exposed?.checkpoint
        if (diagnostics.length < 100)
          diagnostics.push({
            component: current.type?.__name ?? current.type?.name ?? null,
            origin,
            exposedKeys:
              exposed && typeof exposed === 'object' ? Object.keys(exposed).slice(0, 24) : [],
            lightingType: typeof lighting,
            snapshotType: typeof lighting?.snapshot,
            setSignalsType: typeof lighting?.setSignals,
            checkpointType: typeof checkpoint,
          })
        if (lighting?.snapshot && lighting?.setSignals && typeof checkpoint === 'function')
          return { lighting, checkpoint: () => checkpoint.call(exposed) }
      }
      const found = visit(current.subTree)
      if (found) return found
    }
    if (Array.isArray(vnode.children))
      for (const child of vnode.children) {
        const found = visit(child)
        if (found) return found
      }
    return visit(vnode.suspense?.activeBranch)
  }
  const actual = visit(document.querySelector('#app')?._vnode)
  if (!actual)
    throw new Error(
      'Actual WorkbenchScene lighting/checkpoint exposure unavailable; inspect bridgeDiagnostics (including refs.sceneHost)',
    )
  const checkpoint = actual.checkpoint()
  if (
    !checkpoint ||
    checkpoint.slug !== 'reventon' ||
    !['position', 'target'].every(
      (key) =>
        Array.isArray(checkpoint[key]) &&
        checkpoint[key].length === 3 &&
        checkpoint[key].every(Number.isFinite),
    )
  )
    throw new Error('Actual car camera checkpoint unavailable')
  // Test-context references only. checkpoint pauses observation at this fixed
  // rest pose; no action runs, and this script measures no interaction speed.
  window.__carMaterialFixture = {
    lighting: actual.lighting,
    captureCamera: actual.checkpoint,
    initialCheckpoint: checkpoint,
    gpuErrors: [],
  }
  const device = window.__demo.scene.renderer.instance.backend?.device
  device?.addEventListener('uncapturederror', (event) => {
    window.__carMaterialFixture.gpuErrors.push(event.error?.message ?? 'Unknown WebGPU error')
  })
  return diagnostics
}

async function attachLighting(page) {
  await bridge(page, true)
  return page.evaluate(attachFixtureRuntime)
}

async function completedFrames(page, count, timeout) {
  const previous = await page.evaluate(
    () => window.__carMaterialFixture.lighting.snapshot()?.frames,
  )
  assert.ok(Number.isInteger(previous), 'Real completed coordinator frame count required')
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const current = window.__carMaterialFixture.lighting.snapshot()
          if (current?.error) throw new Error(current.error)
          return current?.frames ?? -1
        }),
      { timeout, intervals: [50, 100, 250] },
    )
    .toBeGreaterThanOrEqual(previous + count)
  return page.evaluate(async () => {
    const renderer = window.__demo.scene.renderer.instance,
      device = renderer.backend?.device
    if (!renderer.isWebGPURenderer || !renderer.backend?.isWebGPUBackend || !device?.queue)
      throw new Error('Native WebGPU renderer/device required')
    await device.queue.onSubmittedWorkDone()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
    return window.__carMaterialFixture.lighting.snapshot()
  })
}

async function actualEvidence(page) {
  return page.evaluate(() => {
    const context = window.__demo.scene,
      scene = context.scene.value,
      renderer = context.renderer.instance,
      camera = context.camera.activeCamera.value,
      roots = scene.children.filter((node) => node.userData.workbenchProduct),
      root = roots[0],
      lighting = window.__carMaterialFixture.lighting.snapshot(),
      pose = window.__carMaterialFixture.captureCamera(),
      textures = new Map(),
      lights = []
    if (!root || !pose || pose.slug !== 'reventon')
      throw new Error('Actual product root/camera checkpoint is missing')
    let triangles = 0,
      meshes = 0,
      nodes = 0
    root.traverse((node) => {
      nodes++
      if (!node.isMesh) return
      meshes++
      triangles +=
        ((node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3) *
        (node.isInstancedMesh ? node.count : 1)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const [slot, texture] of Object.entries(material)) {
          if (!texture?.isTexture) continue
          let entry = textures.get(texture.uuid)
          if (!entry) {
            const backend = renderer.backend.get(texture),
              descriptor = backend.textureDescriptorGPU,
              gpu = backend.texture,
              image = texture.image
            entry = {
              name: texture.name,
              format: texture.format,
              type: texture.type,
              isCompressedTexture: Boolean(texture.isCompressedTexture),
              colorSpace: texture.colorSpace,
              channel: texture.channel,
              width: image?.width ?? null,
              height: image?.height ?? null,
              flipY: texture.flipY,
              generateMipmaps: texture.generateMipmaps,
              cpuMipCount: texture.mipmaps.length,
              cpuMips: texture.mipmaps.map((mip) => ({
                width: mip.width,
                height: mip.height,
                bytes: mip.data?.byteLength ?? null,
              })),
              gpuFormat: gpu?.format ?? descriptor?.format ?? backend.format ?? null,
              gpuWidth: gpu?.width ?? descriptor?.size?.width ?? null,
              gpuHeight: gpu?.height ?? descriptor?.size?.height ?? null,
              gpuMipLevelCount: gpu?.mipLevelCount ?? descriptor?.mipLevelCount ?? null,
              gpuSampleCount: gpu?.sampleCount ?? descriptor?.sampleCount ?? null,
              uses: [],
            }
            textures.set(texture.uuid, entry)
          }
          entry.uses.push({ material: material.name, slot })
        }
      }
    })
    scene.traverse((node) => {
      if (!node.isLight) return
      lights.push({
        type: node.type,
        name: node.name,
        color: node.color.toArray(),
        intensity: node.intensity,
        width: node.width ?? null,
        height: node.height ?? null,
        world: node.matrixWorld.toArray(),
      })
    })
    const canvas = document.querySelector('canvas')
    return {
      fixture: true,
      rootCount: roots.length,
      slug: root.userData.workbenchProduct,
      adapter: root.userData.adapter,
      bundle: root.userData.assetBundle,
      triangles,
      sourceTriangles: root.userData.triangles,
      meshes,
      nodes,
      webgpu: Boolean(
        renderer.isWebGPURenderer &&
        renderer.backend?.isWebGPUBackend &&
        renderer.backend.device?.queue,
      ),
      canvasCount: document.querySelectorAll('canvas').length,
      canvasOutput: { width: canvas.width, height: canvas.height },
      camera: {
        position: camera.position.toArray(),
        target: pose.target,
        checkpointPosition: pose.position,
        quaternion: camera.quaternion.toArray(),
        projection: camera.projectionMatrix.toArray(),
        world: camera.matrixWorld.toArray(),
        fov: camera.fov,
        aspect: camera.aspect,
        zoom: camera.zoom,
        near: camera.near,
        far: camera.far,
        coordinateSystem: camera.coordinateSystem,
        view: camera.view ? { ...camera.view } : null,
      },
      lighting,
      gpuErrors: [...window.__carMaterialFixture.gpuErrors],
      stage: window.__demo.store.presentation.stage,
      rendererSettings: {
        exposure: renderer.toneMappingExposure,
        toneMapping: renderer.toneMapping,
        outputColorSpace: renderer.outputColorSpace,
        environmentIntensity: scene.environmentIntensity,
      },
      environmentPresent: Boolean(scene.environment),
      lights,
      textures: [...textures.values()],
      memory: { ...renderer.info.memory },
    }
  })
}

function near(actual, expected, label, tolerance = 1e-7) {
  assert.equal(actual.length, expected.length, label)
  actual.forEach((value, index) =>
    assert.ok(
      Number.isFinite(value) && Math.abs(value - expected[index]) <= tolerance,
      `${label}[${index}] differs`,
    ),
  )
}

function compareEvidence(original, candidate) {
  for (const key of ['position', 'target', 'quaternion', 'projection', 'world'])
    near(candidate.camera[key], original.camera[key], 'Actual A/B camera ' + key)
  for (const key of ['stage', 'rendererSettings', 'lights', 'canvasOutput'])
    assert.deepEqual(candidate[key], original[key], 'Same A/B ' + key)
  assert.equal(candidate.triangles, original.triangles)
  assert.equal(candidate.meshes, original.meshes)
}

/** Explicit GPU ownership gate: preparing/importing this script never launches a browser. */
export async function runMaterialComparison(options = {}) {
  assert.equal(
    options.allowGpu ?? process.env.CAR_MATERIAL_GPU_ALLOWED === '1',
    true,
    'GPU is owned by other validation. Run only after explicit release with CAR_MATERIAL_GPU_ALLOWED=1.',
  )
  const root = resolve(options.root ?? process.cwd()),
    base = options.base ?? process.env.CHECK_URL ?? 'http://127.0.0.1:5181',
    origin = new URL(base).origin,
    indexPath = options.index ?? process.env.CAR_MATERIAL_INDEX ?? fixturePrefix + 'index.json',
    timeout = Number(options.timeout ?? process.env.CAR_MATERIAL_TIMEOUT ?? 240000),
    outputPath =
      options.output ??
      process.env.CAR_MATERIAL_OUTPUT ??
      fixturePrefix + 'browser/' + new Date().toISOString().replaceAll(/[:.]/g, '-'),
    output = fixturePath(root, outputPath),
    requestedGroup = options.group ?? process.env.CAR_MATERIAL_GROUP
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname),
    'Local production preview only',
  )
  assert.ok(Number.isSafeInteger(timeout) && timeout >= 1000, 'Positive bounded timeout required')
  const report = {
    fixture: true,
    engineeringPassed: false,
    qualityApproved: false,
    fullCarMigrationAccepted: false,
    frameBudgetValidated: false,
    startedAt: new Date().toISOString(),
    origin,
    viewport,
    groups: [],
    errors: [],
    closedContexts: [],
    captureSynchronization:
      'Coordinator successful complete frames, then actual GPUQueue.onSubmittedWorkDone and two animation-frame callbacks before screenshot. No extra render loop, pixel readback, GPU time or presentation-FPS claim.',
    modes: {
      full: 'Existing production realtime SSR + SSGI + filtering + native Physical/HDR/shadows. No DDGI query override.',
      physicalDiagnostic:
        'Test context calls actual exposed setSignals(false,false,false) identically for A/B, keeping native Physical/HDR/shadows. Diagnostic material-isolation view only, not a production quality reduction or full pipeline acceptance.',
    },
    memoryMethod:
      'Native texture target formats/mip descriptors and renderer.info.memory are recorded. Counters/estimated allocation are not measured physical VRAM.',
    fixtureTransport:
      'Manifest/model/PNG/KTX/EXR use real same-origin production-preview HTTP streams after Node-side streaming digest verification. Only the small API product JSON is fulfilled through CDP. Missing static fixture files are temporarily staged by exact manifest in ignored dist/artifacts and uniquely owned cleanup preserves changed/pre-existing files.',
    previousAttemptFailure:
      'The initial route.fulfill attempt base64-encoded a 101 MB GLB into Chromium CDP pipe with max_buffer_size=104857600. The resulting DevTools connection loss was a test-transport failure, not evidence of a GPU validation/device failure.',
    limitations: [],
  }
  await mkdir(output, { recursive: true })
  let browser, activePage
  try {
    const index = JSON.parse(await readFixture(root, indexPath)),
      groups = requestedGroup
        ? index.groups.filter((group) => group.id === requestedGroup)
        : index.groups,
      prepared = []
    assert.equal(index.fixture, true)
    assert.ok(groups.length, 'Requested comparison group is absent')
    if (!requestedGroup) assert.equal(groups.length, 4)
    report.limitations = index.limitations
    // Verify before owning GPU; serial file reads keep full GLB buffers bounded.
    for (const group of groups) {
      assert.deepEqual(
        group.variants.map((variant) => variant.variant),
        ['original', 'candidate'],
      )
      const cases = []
      for (const variant of group.variants)
        cases.push(await prepareComparisonCase(root, group, variant))
      prepared.push({ group, cases })
    }
    browser = await chromium.launch({
      channel: 'msedge',
      headless: process.env.CAR_MATERIAL_HEADED !== '1',
    })
    report.browserVersion = browser.version()
    for (const { group, cases } of prepared) {
      const groupResult = { id: group.id, label: group.label, variants: [] }
      report.groups.push(groupResult)
      for (const fixture of cases) {
        const http = createFixtureHttpSession(root, origin, fixture.files, { timeout }),
          result = {
            variant: fixture.variant,
            fixture: true,
            manifestId: fixture.manifest.id,
            manifestBytes: fixture.manifest.budget.maxBytes,
            errors: [],
            warnings: [],
            failedRequests: [],
            nativeFixtureRequests: [],
            rejectedRequests: [],
            captures: {},
          }
        let context, page
        groupResult.variants.push(result)
        try {
          result.httpPreflight = await http.prepare()
          context = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            reducedMotion: 'reduce',
          })
          page = await context.newPage()
          activePage = page
          page.on('pageerror', (error) =>
            result.errors.push({ type: 'pageerror', message: error.message }),
          )
          page.on('console', (message) => {
            if (message.type() === 'error')
              result.errors.push({ type: 'console', message: message.text() })
            else if (message.type() === 'warning') result.warnings.push(message.text())
          })
          page.on('requestfailed', (request) =>
            result.failedRequests.push({
              path: new URL(request.url()).pathname,
              reason: request.failure()?.errorText,
            }),
          )
          await context.route('**/*', async (route) => {
            const request = route.request(),
              decision = fixtureRequest(origin, request.url(), request.method(), fixture.files)
            if (decision.action === 'product')
              return route.fulfill({
                json: fixture.product,
                headers: { 'Cache-Control': 'no-store' },
              })
            if (decision.action === 'file') {
              if (!http.readyPaths.has(new URL(request.url()).pathname)) {
                result.errors.push({
                  type: 'fixture-route',
                  message: 'Unverified HTTP fixture path',
                })
                return route.abort('blockedbyclient')
              }
              result.nativeFixtureRequests.push(decision.file.path)
              // Never send a model/texture body through CDP: 101 MB GLBs expand
              // beyond the pipe's 100 MiB limit when fulfill base64-encodes them.
              return route.continue()
            }
            if (decision.action === 'reject') {
              result.rejectedRequests.push({
                path: new URL(request.url()).pathname,
                reason: decision.reason,
              })
              return route.abort('blockedbyclient')
            }
            return route.continue()
          })
          await page.goto(origin + '/?product=reventon&renderPipeline=realtime', {
            waitUntil: 'domcontentloaded',
            timeout,
          })
          await page.waitForFunction(
            () =>
              ['ready', 'error', 'content'].includes(
                document.querySelector('.workbench')?.dataset.status,
              ),
            null,
            { timeout },
          )
          const status = await page.locator('.workbench').getAttribute('data-status')
          if (status !== 'ready')
            throw new Error(
              `Fixture scene ${status}: ${await page.locator('.wb-stage-status').innerText()}`,
            )
          await expect(page.locator('.wb-stage')).toHaveAttribute('data-render-backend', 'webgpu')
          await expect(page.locator('canvas')).toHaveCount(1)
          result.bridgeDiagnostics = await attachLighting(page)
          await completedFrames(page, 32, timeout)
          result.full = await actualEvidence(page)
          assert.equal(result.full.webgpu, true)
          assert.equal(result.full.rootCount, 1)
          assert.equal(result.full.adapter, 'reventon-v1')
          assert.equal(result.full.bundle, `${fixture.manifest.id}@${fixture.manifest.version}`)
          assert.equal(result.full.triangles, fixture.record.triangles)
          assert.equal(result.full.sourceTriangles, fixture.record.triangles)
          assert.deepEqual(result.full.gpuErrors, [], 'No native WebGPU validation errors')
          assert.deepEqual(result.full.canvasOutput, viewport)
          assert.deepEqual(result.full.lighting.signals, { ssr: true, ssgi: true, denoise: true })
          near(
            result.full.camera.position,
            fixture.product.presentation.camera.position,
            'Configured near camera',
            1e-6,
          )
          near(
            result.full.camera.target,
            fixture.product.presentation.camera.target,
            'Configured near target',
            1e-6,
          )
          for (const texture of result.full.textures) {
            assert.ok(
              texture.width > 0 && texture.height > 0 && texture.gpuMipLevelCount > 0,
              'Actual uploaded texture descriptor required',
            )
            assert.ok(texture.gpuFormat, 'Actual GPU target format required')
          }
          if (fixture.variant === 'candidate')
            assert.ok(
              result.full.textures.some(
                (texture) => texture.isCompressedTexture && texture.gpuFormat,
              ),
              'Candidate must actually upload a compressed KTX2 texture',
            )
          const captureBase = `${group.id}-${fixture.variant}`
          result.captures.full = captureBase + '-full.png'
          await page.screenshot({
            path: resolve(output, result.captures.full),
            animations: 'disabled',
          })
          await page.evaluate(() =>
            window.__carMaterialFixture.lighting.setSignals(false, false, false),
          )
          await completedFrames(page, 24, timeout)
          result.physicalDiagnostic = await actualEvidence(page)
          assert.deepEqual(
            result.physicalDiagnostic.gpuErrors,
            [],
            'No native diagnostic WebGPU errors',
          )
          assert.deepEqual(result.physicalDiagnostic.lighting.signals, {
            ssr: false,
            ssgi: false,
            denoise: false,
          })
          near(
            result.physicalDiagnostic.camera.position,
            result.full.camera.position,
            'Diagnostic camera position',
          )
          near(
            result.physicalDiagnostic.camera.projection,
            result.full.camera.projection,
            'Diagnostic camera projection',
          )
          result.captures.physicalDiagnostic = captureBase + '-physical-diagnostic.png'
          await page.screenshot({
            path: resolve(output, result.captures.physicalDiagnostic),
            animations: 'disabled',
          })
          assert.deepEqual(result.errors, [], 'Browser error evidence')
          assert.deepEqual(result.rejectedRequests, [], 'No package-escaping requests')
          assert.deepEqual(result.failedRequests, [], 'No failed requests')
          result.engineeringPassed = true
          result.qualityApproved = false
          console.log(
            JSON.stringify({
              fixture: true,
              group: group.id,
              variant: fixture.variant,
              triangles: result.full.triangles,
              compressedTextures: result.full.textures.filter(
                (texture) => texture.isCompressedTexture,
              ).length,
              engineeringPassed: true,
              qualityApproved: false,
            }),
          )
        } catch (error) {
          result.failure = error.message
          result.engineeringPassed = false
          if (page)
            result.bridgeDiagnostics = await page
              .evaluate(() => window.__carMaterialBridgeDiagnostics ?? null)
              .catch(() => result.bridgeDiagnostics ?? null)
          const failure = `${group.id}-${fixture.variant}-failure.png`
          if (page)
            await page
              .screenshot({ path: resolve(output, failure), fullPage: true })
              .then(() => {
                result.captures.failure = failure
              })
              .catch(() => {})
          throw error
        } finally {
          try {
            if (context) {
              await context.close()
              report.closedContexts.push({ group: group.id, variant: fixture.variant })
            }
          } finally {
            result.httpCleanup = await http.dispose()
            activePage = undefined
          }
        }
        if (result.httpCleanup.preserved.length) {
          result.engineeringPassed = false
          throw new Error('Owned fixture cleanup preserved changed files; see httpCleanup evidence')
        }
      }
      compareEvidence(groupResult.variants[0].full, groupResult.variants[1].full)
      compareEvidence(
        groupResult.variants[0].physicalDiagnostic,
        groupResult.variants[1].physicalDiagnostic,
      )
      groupResult.sameInputsVerified = true
      groupResult.qualityApproved = false
    }
    report.engineeringPassed = true
  } catch (error) {
    report.failure = error.stack ?? String(error)
    report.errors.push(error.message)
    if (activePage)
      await activePage
        .screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
        .catch(() => {})
  } finally {
    if (browser) await browser.close()
    report.completedAt = new Date().toISOString()
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  }
  console.log(
    JSON.stringify({
      fixture: true,
      output: outputPath,
      engineeringPassed: report.engineeringPassed,
      qualityApproved: false,
      fullCarMigrationAccepted: false,
      failure: report.failure ?? null,
    }),
  )
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runMaterialComparison()
  if (!report.engineeringPassed) process.exitCode = 1
}
