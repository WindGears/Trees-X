import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { demoProducts } from './config.mjs'
import { prepareArtifacts, verifyPrepared } from './runtime.mjs'
import { readState, writeState } from './state.mjs'

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'trees-demo-prepare-'))
  const config = {
    rootDir,
    distDir: join(rootDir, 'dist'),
    jarPath: join(rootDir, 'server', 'target', 'demo.jar'),
    artifactsDir: join(rootDir, 'artifacts', 'demo'),
  }
  const files = {
    'package.json': '{}',
    'package-lock.json': '{}',
    'index.html': 'source entry',
    'vite.config.ts': 'source config',
    'tsconfig.json': 'source root TypeScript config',
    'tsconfig.app.json': 'source app TypeScript config',
    'src/main.ts': 'source frontend',
    'server/pom.xml': 'source pom',
    'scripts/server.mjs': 'source backend build runner',
    'server/mvnw': 'source Unix Maven launcher',
    'server/mvnw.cmd': 'source Windows Maven launcher',
    'server/.mvn/wrapper/maven-wrapper.properties': 'source Maven distribution',
    'server/src/main/resources/application.yml': 'source backend',
    'scripts/demo.mjs': 'source entry script',
    'scripts/demo/runtime.mjs': 'source runtime',
    'public/draco/draco_wasm_wrapper.js': 'decoder wrapper',
    'public/draco/draco_decoder.wasm': 'decoder wasm',
    'public/covers/product.png': 'cover',
  }
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(rootDir, path)), { recursive: true })
    await writeFile(join(rootDir, path), content)
  }
  for (const product of demoProducts) {
    const path = join(rootDir, 'public', product.manifest.slice(1))
    const model = Buffer.from('glTF-' + product.slug)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(join(dirname(path), 'model.glb'), model)
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        entry: 'model.glb',
        files: [
          {
            path: 'model.glb',
            bytes: model.length,
            sha256: createHash('sha256').update(model).digest('hex'),
          },
        ],
      }),
    )
  }
  await mkdir(config.artifactsDir, { recursive: true })
  const builds = []
  async function build(current, script) {
    assert.equal(current, config)
    builds.push(script)
    if (script === 'build') {
      await cp(join(rootDir, 'public'), config.distDir, { recursive: true })
      await mkdir(join(config.distDir, 'assets'))
      await writeFile(join(config.distDir, 'index.html'), '<script src="/assets/app.js"></script>')
      await writeFile(join(config.distDir, 'assets', 'app.js'), 'production frontend')
    } else if (script === 'server:build') {
      await mkdir(dirname(config.jarPath), { recursive: true })
      await writeFile(config.jarPath, Buffer.from('504b0304', 'hex'))
    } else assert.fail('unexpected build script: ' + script)
  }
  return { config, build, builds }
}

test('stable preparation records complete production support digests and rejects later output mutation', async () => {
  const { config, build, builds } = await fixture()
  try {
    const receipt = await prepareArtifacts(config, '17.0.18', build)
    assert.deepEqual(builds, ['build', 'server:build'])
    assert.deepEqual(await readState(join(config.artifactsDir, 'prepared.json')), receipt)
    assert.deepEqual(
      receipt.support.map((file) => file.path),
      ['covers/product.png', 'draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js'],
    )
    assert.deepEqual(
      (await verifyPrepared(config)).products,
      demoProducts.map((item) => item.slug),
    )
    await writeFile(join(config.distDir, 'covers/product.png'), 'changed production cover')
    await assert.rejects(verifyPrepared(config), /生产产物已改变/)
  } finally {
    await rm(config.rootDir, { recursive: true, force: true })
  }
})

test('changed TypeScript and Maven inputs invalidate prepared artifacts', async () => {
  const { config, build } = await fixture()
  try {
    await prepareArtifacts(config, '17.0.18', build)
    for (const path of [
      'tsconfig.json',
      'tsconfig.app.json',
      'scripts/server.mjs',
      'server/mvnw',
      'server/mvnw.cmd',
      'server/.mvn/wrapper/maven-wrapper.properties',
    ]) {
      const absolute = join(config.rootDir, path)
      const original = await readFile(absolute)
      await writeFile(absolute, Buffer.concat([original, Buffer.from('\nchanged build input')]))
      await assert.rejects(verifyPrepared(config), /源码已改变/, path)
      await writeFile(absolute, original)
      assert.equal((await verifyPrepared(config)).products.length, demoProducts.length)
    }
  } finally {
    await rm(config.rootDir, { recursive: true, force: true })
  }
})

test('new TypeScript and optional Maven configuration files also invalidate an existing receipt', async () => {
  const { config, build } = await fixture()
  try {
    await prepareArtifacts(config, '17.0.18', build)
    for (const path of [
      'tsconfig.preview.json',
      'server/.mvn/maven.config',
      'server/.mvn/jvm.config',
    ]) {
      const absolute = join(config.rootDir, path)
      await writeFile(absolute, 'new build configuration')
      await assert.rejects(verifyPrepared(config), /源码已改变/, path)
      await rm(absolute)
      assert.equal((await verifyPrepared(config)).products.length, demoProducts.length)
    }
  } finally {
    await rm(config.rootDir, { recursive: true, force: true })
  }
})

test('input changes during either build refuse a new receipt and preserve the previous receipt', async () => {
  for (const [changedDuring, changedPath] of [
    ['build', 'src/main.ts'],
    ['server:build', 'src/main.ts'],
    ['build', 'tsconfig.app.json'],
    ['server:build', 'server/.mvn/wrapper/maven-wrapper.properties'],
  ]) {
    const { config, build, builds } = await fixture()
    try {
      const path = join(config.artifactsDir, 'prepared.json')
      const previous = { schemaVersion: 1, preparedAt: 'previous receipt' }
      await writeState(path, previous)
      const original = await readFile(path)
      await assert.rejects(
        prepareArtifacts(config, '17.0.18', async (current, script) => {
          await build(current, script)
          if (script === changedDuring)
            await writeFile(join(config.rootDir, changedPath), 'changed during build')
        }),
        /构建输入已改变/,
      )
      assert.deepEqual(builds, ['build', 'server:build'])
      assert.deepEqual(await readFile(path), original)
    } finally {
      await rm(config.rootDir, { recursive: true, force: true })
    }
  }
})

test('a dist support mismatch refuses preparation before any receipt is written', async () => {
  const { config, build } = await fixture()
  try {
    await assert.rejects(
      prepareArtifacts(config, '17.0.18', async (current, script) => {
        await build(current, script)
        if (script === 'build')
          await writeFile(join(config.distDir, 'draco', 'draco_decoder.wasm'), 'mismatched decoder')
      }),
      /解码器或封面摘要不一致/,
    )
    assert.equal(await readState(join(config.artifactsDir, 'prepared.json')), null)
  } finally {
    await rm(config.rootDir, { recursive: true, force: true })
  }
})
