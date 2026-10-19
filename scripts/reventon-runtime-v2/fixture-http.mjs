import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, unlink } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { URL } from 'node:url'
import { relativeResource } from '../asset-package.mjs'

const prefix = 'artifacts/car-runtime-v2/material-comparison/'

function localFile(root, path) {
  relativeResource(path)
  assert.ok(path.startsWith(prefix), 'Only declared ignored fixture resources can be staged')
  return resolve(root, path)
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}

function matches(actual, expected, label) {
  assert.equal(actual.bytes, expected.bytes, 'Byte count mismatch: ' + label)
  assert.equal(actual.sha256, expected.sha256, 'Digest mismatch: ' + label)
}

/** Direct Node HTTP stream, never a CDP fetch/fulfill payload or base64 string. */
export async function verifyFixtureHttp(origin, file, options = {}) {
  relativeResource(file.path)
  assert.ok(file.path.startsWith(prefix), 'HTTP verification requires a declared fixture path')
  const fetcher = options.fetcher ?? globalThis.fetch,
    started = performance.now(),
    response = await fetcher(origin + '/' + file.path, {
      signal: globalThis.AbortSignal.timeout(options.timeout ?? 240000),
      redirect: 'error',
      headers: { 'Cache-Control': 'no-cache' },
    })
  assert.equal(response.status, 200, 'Fixture must be served by production preview: ' + file.path)
  assert.ok(
    !response.headers.get('content-type')?.includes('text/html'),
    'HTML fallback is not a fixture file',
  )
  assert.ok(response.body, 'Fixture HTTP body is required')
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    assert.ok(bytes <= file.bytes, 'HTTP fixture exceeds registered byte count: ' + file.path)
    hash.update(chunk)
  }
  const actual = { bytes, sha256: hash.digest('hex') }
  matches(actual, file, file.path)
  return {
    path: file.path,
    ...actual,
    transport: 'native-same-origin-http-stream',
    wallMs: performance.now() - started,
  }
}

async function safeParent(dist, path) {
  // Walk before creating each component: never mkdir recursively through an
  // existing symlink/junction into masters or another workspace directory.
  let current = dist,
    currentRelative = ''
  for (const component of path.split('/').slice(0, -1)) {
    current = join(current, component)
    currentRelative = currentRelative ? currentRelative + '/' + component : component
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await mkdir(current)
      info = await lstat(current)
    }
    assert.ok(
      info.isDirectory() && !info.isSymbolicLink(),
      'Fixture staging parent must not be a symlink',
    )
    assert.equal(
      relative(dist, await realpath(current)).replaceAll('\\', '/'),
      currentRelative,
      'Fixture staging parent escaped dist',
    )
  }
  return current
}

/** Temporary ignored dist/artifacts mount, owned file by file, without another port. */
export function createFixtureHttpSession(root, origin, files, options = {}) {
  const parsedOrigin = new URL(origin)
  assert.equal(parsedOrigin.origin, origin, 'Origin must not contain a resource path')
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsedOrigin.hostname),
    'Local same-origin preview only',
  )
  const fetcher = options.fetcher ?? globalThis.fetch,
    created = [],
    records = [],
    readyPaths = new Set()
  let disposed = false

  async function stage(file) {
    const source = localFile(root, file.path),
      sourceReal = await realpath(source),
      realRoot = await realpath(root),
      sourceRelative = relative(realRoot, sourceReal).replaceAll('\\', '/')
    assert.ok(sourceRelative.startsWith(prefix), 'Fixture source symlink escapes ignored directory')
    matches(await fileDigest(sourceReal), file, file.path)
    const dist = resolve(root, 'dist'),
      distInfo = await lstat(dist)
    assert.ok(
      distInfo.isDirectory() && !distInfo.isSymbolicLink(),
      'Existing production dist directory required; no symlink',
    )
    const distReal = await realpath(dist)
    assert.equal(
      relative(realRoot, distReal).replaceAll('\\', '/'),
      'dist',
      'Dist must remain in this workspace',
    )
    await safeParent(distReal, file.path)
    const target = resolve(distReal, file.path)
    try {
      const existing = await lstat(target)
      assert.ok(existing.isFile() && !existing.isSymbolicLink(), 'Refuse a non-file fixture target')
      matches(await fileDigest(target), file, 'Existing dist file ' + file.path)
      return 'reused-identical-dist-file'
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await copyFile(sourceReal, target, constants.COPYFILE_EXCL)
    // Register ownership before verification so a failed copy/hash can still
    // leave explicit cleanup evidence. Never overwrite a pre-existing file.
    const info = await lstat(target)
    created.push({
      target,
      dist: distReal,
      path: file.path,
      identity: { ino: info.ino, dev: info.dev, birthtimeMs: info.birthtimeMs },
      expected: { bytes: file.bytes, sha256: file.sha256 },
    })
    matches(await fileDigest(target), file, 'Staged fixture ' + file.path)
    return 'staged-owned-dist-file'
  }

  return {
    records,
    readyPaths,
    async prepare() {
      assert.equal(disposed, false, 'HTTP fixture session disposed')
      for (const [requestPath, file] of files) {
        assert.equal(requestPath, '/' + file.path, 'Only exact registered paths can be staged')
        localFile(root, file.path)
        const head = await fetcher(origin + '/' + file.path, {
          method: 'HEAD',
          signal: globalThis.AbortSignal.timeout(options.timeout ?? 240000),
          redirect: 'error',
        })
        let placement = 'reused-existing-same-origin-http'
        if (
          head.status === 404 ||
          (head.status === 200 && head.headers.get('content-type')?.includes('text/html'))
        )
          placement = await stage(file)
        else
          assert.equal(
            head.status,
            200,
            'Production preview unavailable; no arbitrary resource fallback',
          )
        const record = await verifyFixtureHttp(origin, file, { ...options, fetcher })
        records.push({ ...record, placement })
        readyPaths.add('/' + file.path)
      }
      return records
    },
    async dispose() {
      if (disposed) return { deleted: [], preserved: [], alreadyDisposed: true }
      disposed = true
      const result = { deleted: [], preserved: [] }
      for (let index = created.length - 1; index >= 0; index--) {
        const file = created[index]
        try {
          const info = await lstat(file.target)
          assert.ok(info.isFile() && !info.isSymbolicLink(), 'Owned file replaced by another type')
          assert.deepEqual(
            { ino: info.ino, dev: info.dev, birthtimeMs: info.birthtimeMs },
            file.identity,
            'Owned file identity changed',
          )
          assert.equal(
            relative(file.dist, await realpath(file.target)).replaceAll('\\', '/'),
            file.path,
            'Owned fixture target moved outside expected dist path',
          )
          // If the build replaced dist or another task changed bytes, preserve it.
          matches(await fileDigest(file.target), file.expected, 'Owned cleanup ' + file.path)
          await unlink(file.target)
          result.deleted.push(file.path)
        } catch (error) {
          if (error.code !== 'ENOENT')
            result.preserved.push({ path: file.path, reason: error.message })
        }
      }
      readyPaths.clear()
      return result
    },
  }
}
