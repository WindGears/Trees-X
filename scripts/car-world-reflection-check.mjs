import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const output = 'artifacts/car-showroom/world-reflection-seam'
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    entries: ['src/lib/renderlab/carReflectionFixture.ts'],
  },
  plugins: [
    {
      name: 'world-reflection-fixture',
      configureServer(server) {
        server.middlewares.use('/__reflection.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html')
          res.end(
            '<!doctype html><link rel="icon" href="data:,"><title>Background reflection validation</title>',
          )
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, open: false },
})
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  passed: false,
  errors: [],
  limitation: 'Real GPU SSR miss seam fixture; not whole-car material or visual acceptance.',
}
try {
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string')
  const page = await browser.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}/__reflection.html`)
  report.result = await page.evaluate(async () => {
    const { runCarReflectionFixture } = await import('/src/lib/renderlab/carReflectionFixture.ts')
    return runCarReflectionFixture()
  })
  assert.equal(report.result.backend, 'WebGPUBackend')
  assert.deepEqual(report.errors, [], 'GPU/TSL errors invalidate all pixel evidence')
  for (const round of report.result.rounds) {
    assert.equal(round.maxDisabledError, 0, `${round.state}: disabled matches upstream`)
    assert.equal(round.maxDeclinedError, 0, `${round.state}: rejected hits preserve fallback`)
    assert.equal(round.maxHitError, 0, `${round.state}: SSR hits retain priority`)
  }
  const [visible, axis, moved, priority] = report.result.rounds
  assert(axis.worldHits > 1000, 'Axis-aligned normals generate valid world reflection rays')
  assert(axis.colors.length >= 4, 'Axis-aligned normals preserve textured radiance')
  assert(visible.worldHits > 1000, 'Offscreen textured panel produces world hits')
  assert(visible.colors.length >= 4, 'Actual UV texture has distinct colors')
  assert.equal(moved.worldHits, 0, 'Moved panel no longer reflects')
  assert(priority.ssrHits > 30, 'Visible box exercises SSR-hit priority')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error.stack || error)
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, output }))
}
