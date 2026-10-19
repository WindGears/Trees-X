import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'

const output = process.env.CAR_SHADOW_OUTPUT || 'artifacts/car-webgpu/shadow-probe',
  report = {
    passed: false,
    method:
      'Isolated caster + receiver; one live renderer per page, WebGL and WebGPU sequential. Copies final vertical-blur target and intermediate horizontal target after all three passes, not raw depth. 2048-square RGBA8 / 65 taps. Pixel centroids are converted back to world X/Z; actual GPU presentation is not timed.',
    runs: [],
    errors: [],
  },
  server = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 5196, strictPort: true },
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
      include: ['three', 'three/webgpu', 'three/tsl'],
    },
    plugins: [
      {
        name: 'car-shadow-fixture',
        configureServer(vite) {
          vite.middlewares.use('/favicon.ico', (_req, res) => {
            res.statusCode = 204
            res.end()
          })
          vite.middlewares.use('/__car-shadow.html', (_req, res) => {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              '<!doctype html><html><body style="margin:0"><script type="module" src="/scripts/reventon-shadow-fixture.ts"></script></body></html>',
            )
          })
        },
      },
    ],
  })
let browser
try {
  await mkdir(output, { recursive: true })
  await server.listen()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  for (const backend of ['webgl', 'webgpu']) {
    const page = await browser.newPage({ viewport: { width: 768, height: 768 } })
    page.on('pageerror', (error) => report.errors.push(`${backend}: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push(`${backend}: ${message.text()}`)
    })
    try {
      await page.goto(`http://127.0.0.1:5196/__car-shadow.html?backend=${backend}`)
      await page.waitForFunction(
        () => window.carShadowFixture || window.carShadowFixtureError,
        undefined,
        {
          timeout: 90_000,
        },
      )
      const result = await page.evaluate(() => ({
        result: window.carShadowFixture,
        error: window.carShadowFixtureError,
      }))
      if (result.error) throw new Error(result.error)
      report.runs.push(result.result)
      await page.screenshot({ path: `${output}/${backend}.png` })
    } finally {
      await page.close()
    }
  }
  const [gl, gpu] = report.runs
  report.passed =
    report.errors.length === 0 &&
    [gl, gpu].every(
      (run) =>
        Math.abs(run.presentation.x - 1.15) < 0.03 && Math.abs(run.presentation.z - 2.2) < 0.03,
    )
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
}
