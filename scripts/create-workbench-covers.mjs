import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { format } from 'prettier'

const base = process.env.CHECK_URL || 'http://127.0.0.1:5181'
const output = 'public/covers/workbench'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const covers = []
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 796 },
    reducedMotion: 'reduce',
  })
  for (const slug of ['form-01', 'typewriter-study', 'reventon']) {
    await page.goto(`${base}/?product=${slug}`)
    await expect(page.locator('.workbench')).toHaveAttribute('data-status', 'ready', {
      timeout: 30000,
    })
    await expect(page.locator('canvas')).toHaveCount(1)
    // A canvas element screenshot also captures overlapping DOM. Hide it explicitly.
    await page.addStyleTag({
      content:
        '.wb-intro, .wb-hotspots, .wb-tools, .wb-input-hint, .wb-keyboard-hint { visibility: hidden !important; }',
    })
    await page.locator('canvas').screenshot({ path: `${output}/${slug}.png` })
    const data = await readFile(`${output}/${slug}.png`)
    covers.push({
      slug,
      path: `/covers/workbench/${slug}.png`,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    })
  }
  await writeFile(
    `${output}/manifest.json`,
    await format(
      JSON.stringify(
        {
          source:
            'Trees X procedural workflow prototypes; real Three.js canvas captures, not formal GLB assets',
          generator: 'scripts/create-workbench-covers.mjs',
          size: [960, 720],
          covers,
        },
        null,
        2,
      ),
      { parser: 'json' },
    ),
  )
} finally {
  await browser.close()
}
console.log(JSON.stringify(covers, null, 2))
