import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { jsonText } from '../asset-package.mjs'
import { verifyRuntime } from './build-runtime-verify.mjs'

async function assertTraceFinalizationUnlocked(root) {
  try {
    await lstat(resolve(root, 'public/models/reventon-runtime-v2/.trace-finalize.lock'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Runtime registration is blocked by trace finalization (.trace-finalize.lock)')
}

async function existingDescriptor(path, expected) {
  let bytes
  try {
    bytes = await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  assert.deepEqual(
    JSON.parse(bytes),
    expected,
    'A different runtime descriptor is already registered; refusing to overwrite it',
  )
  return true
}

/** Testable publication workflow; the production registrar below fixes its verifier. */
export function createRuntimeRegistrar(verify) {
  return async function register(root = process.cwd()) {
    // Do not finalize/copy motion here: missing production assets must fail registration.
    await assertTraceFinalizationUnlocked(root)
    const report = await verify(root)
    assert.equal(report.passed, true, 'Complete runtime verification must pass')
    const bundle = JSON.parse(
      await readFile(resolve(root, 'public/models/reventon-runtime-v2/bundle-reference.json')),
    )
    assert.deepEqual(bundle, report.bundle, 'Runtime reference changed after verification')
    assert.equal(bundle.id, 'reventon-workbench')
    assert.equal(bundle.version, 2)
    assert.equal(bundle.manifest, '/models/reventon-runtime-v2/workbench-manifest.json')
    assert.match(bundle.sha256, /^[a-f0-9]{64}$/)
    const path = resolve(root, 'src/lib/workbench/reventonRuntimeBundle.json')
    const result = (status) => ({
      status,
      path,
      bundle,
      bytes: report.bytes,
      textures: report.textures.length,
    })
    if (await existingDescriptor(path, bundle)) return result('unchanged')
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx')
      try {
        await handle.writeFile(await jsonText(bundle))
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await assertTraceFinalizationUnlocked(root)
        // A same-directory hard link publishes only complete bytes and never replaces a
        // descriptor that another registration created after our initial existence check.
        await link(temporary, path)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        assert.ok(
          await existingDescriptor(path, bundle),
          'Concurrent registration must still exist',
        )
        return result('unchanged')
      }
      return result('registered')
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
}

/** Production callers cannot override the audited source identity or its verifier. */
export const registerRuntime = createRuntimeRegistrar(verifyRuntime)

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve('scripts/reventon-runtime-v2/register-runtime.mjs')
) {
  registerRuntime()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
