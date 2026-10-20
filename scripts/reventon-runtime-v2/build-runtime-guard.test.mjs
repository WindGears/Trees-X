import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { assertRuntimeBuildUnregistered } from './build-runtime.mjs'

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'trees-runtime-build-guard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, descriptor: resolve(root, 'src/lib/workbench/reventonRuntimeBundle.json') }
}

test('an unregistered workspace can start without the guard creating any files', async (t) => {
  const { root } = await fixture(t)
  await assertRuntimeBuildUnregistered(root)
  assert.deepEqual(await readdir(root), [])
})

test('a registered descriptor blocks rebuilding even when production records are absent', async (t) => {
  const { root, descriptor } = await fixture(t)
  await mkdir(resolve(root, 'src/lib/workbench'), { recursive: true })
  for (const bytes of [Buffer.alloc(0), Buffer.from('{unfinished'), Buffer.from('{"version":2}')]) {
    await writeFile(descriptor, bytes)
    await assert.rejects(assertRuntimeBuildUnregistered(root), /already registered/)
    assert.deepEqual(await readFile(descriptor), bytes)
    assert.deepEqual(await readdir(root), ['src'])
  }
})

test('an unexpected descriptor directory also blocks a build instead of treating it as missing', async (t) => {
  const { root, descriptor } = await fixture(t)
  await mkdir(descriptor, { recursive: true })
  await assert.rejects(assertRuntimeBuildUnregistered(root), /already registered/)
  assert.deepEqual(await readdir(descriptor), [])
})
