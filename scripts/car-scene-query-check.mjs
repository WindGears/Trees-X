import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const output = 'artifacts/car-showroom/world-query'
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  optimizeDeps: {
    include: ['three', 'three/webgpu', 'three/tsl', 'three-mesh-bvh', 'three-mesh-bvh/webgpu'],
    entries: ['src/lib/renderlab/carQueryFixture.ts'],
  },
  plugins: [
    {
      name: 'car-query-fixture',
      configureServer(server) {
        server.middlewares.use('/__car-query.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html')
          res.end(
            '<!doctype html><link rel="icon" href="data:,"><title>Isolated car query GPU check</title>',
          )
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
})
await server.listen()
const address = server.httpServer.address()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  passed: false,
  errors: [],
  result: null,
  limitation:
    'Query contract fixture only; no material shading or integrated reflection quality claim.',
}
try {
  assert(address && typeof address !== 'string')
  const page = await browser.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}/__car-query.html`)
  report.result = await page.evaluate(async () => {
    const { runCarQueryFixture } = await import('/src/lib/renderlab/carQueryFixture.ts')
    return runCarQueryFixture()
  })
  assert.equal(report.result.backend, 'WebGPUBackend')
  let checks = 0
  for (const round of report.result.rounds)
    for (const item of round.cases) {
      const [hit, distance] = item.gpu
      assert.equal(hit, Number(Boolean(item.expected)), `${round.state}/${item.id}: hit`)
      assert.equal(item.gpu[16], hit, `${round.state}/${item.id}: occlusion parity`)
      if (item.expected) {
        assert(
          Math.abs(distance - item.expected.distance) < 1e-5,
          `${round.state}/${item.id}: distance`,
        )
        assert.equal(item.sourceName, item.expected.sourceName)
        assert.equal(item.gpu[3], item.expected.side)
        for (let n = 0; n < 3; n++)
          assert(
            Math.abs(item.reconstructedPoint[n] - item.expected.point[n]) < 1e-5,
            `${round.state}/${item.id}: packed vertices and barycentric correspondence`,
          )
        assert(Math.abs(item.gpu[8] + item.gpu[9] + item.gpu[10] - 1) < 1e-5)
        for (let n = 0; n < 3; n++)
          assert(
            Math.abs(item.gpu[4 + n] - item.expected.normal[n]) < 1e-5,
            `${round.state}/${item.id}: normal`,
          )
      }
      checks++
    }
  assert.equal(report.result.rounds.at(-1).resources.transformUpdates, 3)
  assert.deepEqual(report.errors, [])
  report.checks = checks
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
