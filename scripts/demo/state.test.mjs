import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { readState, sourceFingerprint, withControlLock, writeState } from './state.mjs'

test('control lock refuses a live owner and releases after a failing action', async () => {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'trees-demo-lock-'))
  const config = { artifactsDir }
  try {
    await assert.rejects(
      withControlLock(config, async () => {
        await assert.rejects(
          withControlLock(config, () => assert.fail('concurrent action must never run')),
          /仍在运行/,
        )
        throw new Error('intentional failure')
      }),
      /intentional failure/,
    )
    assert.equal(await readState(join(artifactsDir, 'control.lock')), null)
    const result = await withControlLock(config, async () => 'next operation')
    assert.equal(result, 'next operation')
  } finally {
    await rm(artifactsDir, { recursive: true, force: true })
  }
})

test('concurrent stale-lock attempts preserve the original lock and never enter an action', async () => {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'trees-demo-stale-lock-'))
  try {
    const original = {
      pid: process.pid,
      startedAt: 'different creation time',
    }
    await writeState(join(artifactsDir, 'control.lock'), original)
    const attempts = await Promise.allSettled([
      withControlLock({ artifactsDir }, () => assert.fail('stale lock must never be reclaimed')),
      withControlLock({ artifactsDir }, () => assert.fail('concurrent collector must never run')),
    ])
    for (const attempt of attempts) {
      assert.equal(attempt.status, 'rejected')
      assert.match(attempt.reason.message, /不自动回收锁/)
    }
    assert.deepEqual(await readState(join(artifactsDir, 'control.lock')), original)
  } finally {
    await rm(artifactsDir, { recursive: true, force: true })
  }
})

test('prepared fingerprint detects app, jar inputs and runtime script changes while excluding local credentials and test scripts', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'trees-demo-fingerprint-'))
  const files = {
    'package.json': '{"scripts":{}}',
    'package-lock.json': '{}',
    'index.html': 'index',
    'vite.config.ts': 'config',
    'tsconfig.json': 'root TypeScript config',
    'tsconfig.app.json': 'app TypeScript config',
    'tsconfig.node.json': 'node TypeScript config',
    'src/main.ts': 'frontend',
    'server/pom.xml': 'pom',
    'scripts/server.mjs': 'backend build runner',
    'server/mvnw': 'Unix Maven launcher',
    'server/mvnw.cmd': 'Windows Maven launcher',
    'server/.mvn/wrapper/maven-wrapper.properties': 'Maven distribution',
    'server/.mvn/maven.config': 'Maven options',
    'server/.mvn/jvm.config': 'Maven Java options',
    'server/src/main/resources/application.yml': 'backend',
    'scripts/demo.mjs': 'entry',
    'scripts/demo-database.mjs': 'database entry',
    'scripts/demo/preview.mjs': 'preview runtime',
    'scripts/demo/config.mjs': 'shared config',
    'scripts/demo/runtime.mjs': 'runtime',
    'public/draco/draco_wasm_wrapper.js': 'decoder',
    'public/covers/product.png': 'cover',
  }
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(rootDir, path)), { recursive: true })
      await writeFile(join(rootDir, path), text)
    }
    const original = await sourceFingerprint(rootDir)
    for (const path of [
      'src/main.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.node.json',
      'server/src/main/resources/application.yml',
      'scripts/server.mjs',
      'server/mvnw',
      'server/mvnw.cmd',
      'server/.mvn/wrapper/maven-wrapper.properties',
      'server/.mvn/maven.config',
      'server/.mvn/jvm.config',
      'scripts/demo.mjs',
      'scripts/demo-database.mjs',
      'scripts/demo/preview.mjs',
      'scripts/demo/config.mjs',
      'public/draco/draco_wasm_wrapper.js',
      'public/covers/product.png',
    ]) {
      await writeFile(join(rootDir, path), files[path] + ' changed')
      assert.notEqual(await sourceFingerprint(rootDir), original, path)
      await writeFile(join(rootDir, path), files[path])
    }
    await writeFile(join(rootDir, 'server/.env.local'), 'TREES_DB_PASSWORD=local-secret')
    await writeFile(join(rootDir, 'scripts/demo/config.test.mjs'), 'test only')
    await writeFile(join(rootDir, 'scripts/demo/browser-check.mjs'), 'browser acceptance only')
    assert.equal(await sourceFingerprint(rootDir), original)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
