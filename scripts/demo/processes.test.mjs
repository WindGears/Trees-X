import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ownsProcess, portAvailable, readProcess, spawnOwned, stopOwned } from './processes.mjs'

test('ownership requires the exact PID, creation time, executable, command and run marker', () => {
  const runId = randomUUID()
  const record = {
    kind: 'preview',
    runId,
    pid: 42,
    startedAt: 'time-1',
    executable: 'C:\\Node\\node.exe',
    commandLine: `C:\\Node\\node.exe C:\\repo\\preview.mjs --run-id=${runId}`,
  }
  const actual = { ...record }
  const expected = {
    kind: 'preview',
    executable: 'C:\\Node\\node.exe',
    script: 'C:\\repo\\preview.mjs',
  }
  assert.equal(ownsProcess(record, actual, expected, 'win32'), true)
  for (const override of [
    { pid: 43 },
    { startedAt: 'time-2' },
    { executable: 'C:\\other.exe' },
    { commandLine: actual.commandLine + ' changed' },
  ])
    assert.equal(ownsProcess(record, { ...actual, ...override }, expected, 'win32'), false)
  assert.equal(ownsProcess({ ...record, runId: randomUUID() }, actual, expected, 'win32'), false)
  assert.equal(ownsProcess(record, actual, { ...expected, script: 'foreign.mjs' }, 'win32'), false)
})

test('occupied ports are reported without affecting their listener', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    assert.equal(await portAvailable('127.0.0.1', port), false)
    assert.equal(server.listening, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a real directly spawned child is registered, refuses mismatched identity, and stops through verified ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trees-demo-process-'))
  const script = join(directory, 'preview.mjs')
  const runId = randomUUID()
  const expected = { kind: 'preview', executable: process.execPath, script }
  let record
  try {
    await writeFile(script, 'setInterval(() => {}, 1000)\n')
    record = await spawnOwned({
      executable: process.execPath,
      args: [script, `--run-id=${runId}`],
      cwd: directory,
      env: process.env,
      logPath: join(directory, 'child.log'),
      kind: 'preview',
      runId,
    })
    assert.equal(ownsProcess(record, await readProcess(record.pid), expected), true)
    assert.equal(await stopOwned({ ...record, startedAt: 'another process' }, expected), 'foreign')
    assert.equal(ownsProcess(record, await readProcess(record.pid), expected), true)
    assert.equal(await stopOwned(record, expected), 'stopped')
    assert.equal(await readProcess(record.pid), null)
  } finally {
    if (record) await stopOwned(record, expected)
    await rm(directory, { recursive: true, force: true })
  }
})
