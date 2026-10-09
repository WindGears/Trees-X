/* global window */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { jsonText } from './asset-package.mjs'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto('http://127.0.0.1:5183/typewriter/?s=0&freeze=1')
  await page.waitForFunction(() => window.__APP?.loaded, null, { timeout: 90000 })
  const samples = await page.evaluate(() => {
    const parts = window.__TYPEWRITER.getParts()
    const indices = [...new Set(parts.map((p) => p.g))].map(
      (group) => parts.find((p) => p.g === group).id,
    )
    const result = []
    for (let index = 0; index <= 100; index++) {
      const progress = index / 100
      window.__TYPEWRITER.setS(progress, { immediate: true })
      result.push({
        progress,
        parts: indices.map((id) => ({
          id,
          position: parts[id].p.toArray(),
          quaternion: parts[id].q.toArray(),
        })),
      })
    }
    return result
  })
  await mkdir('src/lib/workbench/__fixtures__', { recursive: true })
  await writeFile(
    'src/lib/workbench/__fixtures__/typewriter-source-poses.json',
    await jsonText({
      source:
        'Original owner-created Kimi runtime, evaluated at 101 exact progress points for each of eight semantic groups.',
      samples,
    }),
  )
  console.log(JSON.stringify({ samples: samples.length, groups: samples[0].parts.length }))
} finally {
  await browser.close()
}
