import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { URL } from 'node:url'
import test from 'node:test'
import { createFixtureHttpSession, verifyFixtureHttp } from './fixture-http.mjs'

const prefix = 'artifacts/car-runtime-v2/material-comparison/',
  origin = 'http://127.0.0.1:5181'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'trees-material-http-')),
    path = prefix + 'test/model.glb',
    bytes = Buffer.from('test GLB bytes served by native static HTTP'),
    file = { path, bytes: bytes.length, sha256: digest(bytes) },
    source = resolve(root, path),
    target = resolve(root, 'dist', path)
  t.after(async () => {
    const absolute = resolve(root),
      temporary = resolve(tmpdir())
    assert.ok(
      absolute.startsWith(temporary + sep) && basename(absolute).startsWith('trees-material-http-'),
      'Verify exact disposable test directory before recursive cleanup',
    )
    await rm(absolute, { recursive: true, force: true })
  })
  await mkdir(dirname(source), { recursive: true })
  await writeFile(source, bytes)
  await mkdir(resolve(root, 'dist'))
  const fetcher = async (url, options = {}) => {
    const request = new URL(url)
    assert.equal(request.origin, origin)
    assert.equal(request.pathname, '/' + path)
    let value
    try {
      value = await readFile(target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return new globalThis.Response(
        options.method === 'HEAD' ? null : '<html>preview fallback</html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    return new globalThis.Response(options.method === 'HEAD' ? null : value, {
      status: 200,
      headers: { 'Content-Type': 'model/gltf-binary', 'Content-Length': String(value.length) },
    })
  }
  return { root, path, bytes, file, source, target, files: new Map([['/' + path, file]]), fetcher }
}

test('streams the 101 MB regression case without CDP/base64 or whole-body arrayBuffer', async () => {
  const total = 101099092,
    chunk = Buffer.alloc(1024 * 1024, 37),
    expected = createHash('sha256')
  for (let left = total; left > 0; left -= chunk.length)
    expected.update(chunk.subarray(0, Math.min(left, chunk.length)))
  assert.ok(
    Math.ceil(total / 3) * 4 > 104857600,
    'Original route.fulfill base64 exceeded Chromium pipe limit',
  )
  let remaining = total,
    chunks = 0
  const response = new globalThis.Response(
    new globalThis.ReadableStream({
      pull(controller) {
        if (!remaining) {
          controller.close()
          return
        }
        const part = chunk.subarray(0, Math.min(remaining, chunk.length))
        remaining -= part.length
        chunks++
        controller.enqueue(part)
      },
    }),
    { headers: { 'Content-Type': 'model/gltf-binary' } },
  )
  response.arrayBuffer = () =>
    assert.fail('The regression must consume a stream, not a whole-body buffer')
  const result = await verifyFixtureHttp(
    origin,
    { path: prefix + 'test/model.glb', bytes: total, sha256: expected.digest('hex') },
    { fetcher: async () => response },
  )
  assert.equal(result.bytes, total)
  assert.equal(result.transport, 'native-same-origin-http-stream')
  assert.ok(chunks > 90)
})

test('stages only missing ignored fixture files, validates HTTP and removes uniquely owned unchanged files', async (t) => {
  const f = await fixture(t),
    session = createFixtureHttpSession(f.root, origin, f.files, { fetcher: f.fetcher })
  const records = await session.prepare()
  assert.equal(records[0].placement, 'staged-owned-dist-file')
  assert.equal(records[0].sha256, f.file.sha256)
  assert.equal(session.readyPaths.has('/' + f.path), true)
  assert.deepEqual(await readFile(f.source), f.bytes)
  assert.deepEqual(await readFile(f.target), f.bytes)
  assert.deepEqual(await session.dispose(), { deleted: [f.path], preserved: [] })
  await assert.rejects(stat(f.target), { code: 'ENOENT' })
  assert.deepEqual(await readFile(f.source), f.bytes)
})

test('reuses matching existing same-origin files without claiming cleanup ownership', async (t) => {
  const f = await fixture(t)
  await mkdir(dirname(f.target), { recursive: true })
  await writeFile(f.target, f.bytes)
  const session = createFixtureHttpSession(f.root, origin, f.files, { fetcher: f.fetcher })
  assert.equal((await session.prepare())[0].placement, 'reused-existing-same-origin-http')
  assert.deepEqual(await session.dispose(), { deleted: [], preserved: [] })
  assert.deepEqual(await readFile(f.target), f.bytes)
})

test('does not overwrite mismatched files or delete an owned file changed after staging', async (t) => {
  const f = await fixture(t),
    session = createFixtureHttpSession(f.root, origin, f.files, { fetcher: f.fetcher })
  await session.prepare()
  const changed = Buffer.from('updated by another owner')
  await writeFile(f.target, changed)
  const cleanup = await session.dispose()
  assert.equal(cleanup.deleted.length, 0)
  assert.equal(cleanup.preserved[0].path, f.path)
  assert.deepEqual(await readFile(f.target), changed)
  const next = createFixtureHttpSession(f.root, origin, f.files, { fetcher: f.fetcher })
  await assert.rejects(next.prepare(), /mismatch/)
  assert.deepEqual(await next.dispose(), { deleted: [], preserved: [] })
  assert.deepEqual(await readFile(f.target), changed)
})

test('refuses HTML fallback, digest mismatch and unregistered HTTP paths', async () => {
  const file = { path: prefix + 'test/model.glb', bytes: 3, sha256: digest(Buffer.from('abc')) }
  await assert.rejects(
    verifyFixtureHttp(origin, file, {
      fetcher: async () =>
        new globalThis.Response('abc', { headers: { 'Content-Type': 'text/html' } }),
    }),
    /HTML fallback/,
  )
  await assert.rejects(
    verifyFixtureHttp(origin, file, { fetcher: async () => new globalThis.Response('xyz') }),
    /Digest mismatch/,
  )
  await assert.rejects(
    verifyFixtureHttp(origin, { ...file, path: 'server/.env.local' }),
    /declared fixture/,
  )
})

test('refuses staging through a directory symlink or junction', async (t) => {
  const f = await fixture(t),
    outside = resolve(f.root, 'outside-dist')
  await mkdir(outside)
  try {
    await symlink(
      outside,
      resolve(f.root, 'dist/artifacts'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Directory symlink permission unavailable')
      return
    }
    throw error
  }
  const session = createFixtureHttpSession(f.root, origin, f.files, { fetcher: f.fetcher })
  await assert.rejects(session.prepare(), /symlink/)
  assert.deepEqual(await session.dispose(), { deleted: [], preserved: [] })
  await assert.rejects(stat(resolve(outside, 'car-runtime-v2')), { code: 'ENOENT' })
})
