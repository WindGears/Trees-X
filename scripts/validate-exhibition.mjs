import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
const directory = process.env.REPORT_DIR || '.impeccable/review/exhibition-validation'
await mkdir(directory, { recursive: true })
const report = []
for (const name of [
  'product-identity',
  'render-handoff',
  'browser',
  'collection',
  'experience',
  'gesture',
  'gesture-interaction',
  'gesture-motion',
  'gesture-dwell',
  'visual-effects',
  'exhibition',
]) {
  const started = Date.now()
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${name}-check.mjs`], {
      env: { ...process.env, CHECK_URL: process.env.CHECK_URL || 'http://127.0.0.1:5181' },
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => resolve({ code, output }))
  })
  await writeFile(`${directory}/${name}.log`, result.output)
  report.push({ name, exitCode: result.code, seconds: Math.round((Date.now() - started) / 1000) })
  await writeFile(`${directory}/summary.json`, JSON.stringify(report, null, 2))
  console.log(`${name}: ${result.code === 0 ? 'PASS' : 'FAIL'} (${report.at(-1).seconds}s)`)
}
if (report.some((result) => result.exitCode !== 0)) process.exitCode = 1
