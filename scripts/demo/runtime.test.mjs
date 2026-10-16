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
    'renderlab.html': 'comparison entry',
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
    'public/models/denoise/rt_hdr_alb_nrm.tza': 'guided denoise weights',
    'public/studio/amber-lounge/v1/lounge-panorama.png': 'amber lounge panorama',
    'public/studio/amber-lounge/v1/stone-basecolor.png': 'amber stone basecolor',
    'public/studio/amber-lounge/v1/stone-roughness.png': 'amber roughness data',
    'public/studio/amber-lounge/v1/stone-normal.png': 'amber normal data',
    'public/studio/amber-lounge/spatial-v1/radial-distance.f32': 'radial distance float data',
    'public/studio/amber-lounge/spatial-v1/DA2-LICENSE.txt': 'Apache-2.0',
    'public/studio/amber-lounge/layers-v1/clean-room.png': 'inferred room background',
    'public/studio/amber-lounge/layers-v1/chair-table.png': 'fixed chair and table RGBA',
    'public/studio/amber-lounge/layers-v1/table-lamp.png': 'fixed lamp RGBA',
  }
  files['public/models/denoise/manifest.json'] = JSON.stringify({
    schemaVersion: 1,
    entry: 'rt_hdr_alb_nrm.tza',
    files: [
      {
        path: 'rt_hdr_alb_nrm.tza',
        bytes: Buffer.byteLength(files['public/models/denoise/rt_hdr_alb_nrm.tza']),
        sha256: createHash('sha256')
          .update(files['public/models/denoise/rt_hdr_alb_nrm.tza'])
          .digest('hex'),
      },
    ],
  })
  files['public/studio/amber-lounge/v1/manifest.json'] = JSON.stringify({
    schemaVersion: 1,
    id: 'amber-lounge-v1',
    entry: 'lounge-panorama.png',
    files: [
      'lounge-panorama.png',
      'stone-basecolor.png',
      'stone-roughness.png',
      'stone-normal.png',
    ].map((path) => ({
      path,
      bytes: Buffer.byteLength(files['public/studio/amber-lounge/v1/' + path]),
      sha256: createHash('sha256')
        .update(files['public/studio/amber-lounge/v1/' + path])
        .digest('hex'),
    })),
  })
  for (const [pack, entry, paths] of [
    ['spatial-v1', 'radial-distance.f32', ['radial-distance.f32', 'DA2-LICENSE.txt']],
    ['layers-v1', 'clean-room.png', ['clean-room.png', 'chair-table.png', 'table-lamp.png']],
  ]) {
    const directory = 'public/studio/amber-lounge/' + pack + '/'
    files[directory + 'manifest.json'] = JSON.stringify({
      schemaVersion: 1,
      entry,
      files: paths.map((path) => ({
        path,
        bytes: Buffer.byteLength(files[directory + path]),
        sha256: createHash('sha256')
          .update(files[directory + path])
          .digest('hex'),
      })),
    })
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
      [
        'covers/product.png',
        'draco/draco_decoder.wasm',
        'draco/draco_wasm_wrapper.js',
        'models/denoise/manifest.json',
        'models/denoise/rt_hdr_alb_nrm.tza',
        'studio/amber-lounge/layers-v1/chair-table.png',
        'studio/amber-lounge/layers-v1/clean-room.png',
        'studio/amber-lounge/layers-v1/manifest.json',
        'studio/amber-lounge/layers-v1/table-lamp.png',
        'studio/amber-lounge/spatial-v1/DA2-LICENSE.txt',
        'studio/amber-lounge/spatial-v1/manifest.json',
        'studio/amber-lounge/spatial-v1/radial-distance.f32',
        'studio/amber-lounge/v1/lounge-panorama.png',
        'studio/amber-lounge/v1/manifest.json',
        'studio/amber-lounge/v1/stone-basecolor.png',
        'studio/amber-lounge/v1/stone-normal.png',
        'studio/amber-lounge/v1/stone-roughness.png',
      ],
    )
    assert.deepEqual(
      (await verifyPrepared(config)).products,
      demoProducts.map((item) => item.slug),
    )
    await writeFile(join(config.distDir, 'covers/product.png'), 'changed production cover')
    await assert.rejects(verifyPrepared(config), /生产产物已改变/)
    await writeFile(join(config.distDir, 'covers/product.png'), 'cover')
    for (const file of [
      'v1/lounge-panorama.png',
      'v1/stone-basecolor.png',
      'v1/stone-roughness.png',
      'v1/stone-normal.png',
      'spatial-v1/radial-distance.f32',
      'spatial-v1/DA2-LICENSE.txt',
      'layers-v1/clean-room.png',
      'layers-v1/chair-table.png',
      'layers-v1/table-lamp.png',
    ]) {
      const path = join(config.distDir, 'studio', 'amber-lounge', file)
      const original = await readFile(path)
      const corrupted = Buffer.from(original)
      corrupted[0] ^= 1
      await writeFile(path, corrupted)
      await assert.rejects(verifyPrepared(config), /SHA-256/, file)
      await writeFile(path, original)
    }
    assert.deepEqual(await verifyPrepared(config), {
      preparedAt: receipt.preparedAt,
      products: demoProducts.map((item) => item.slug),
    })
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
      /解码器、封面、降噪或暖夜资源摘要不一致/,
    )
    assert.equal(await readState(join(config.artifactsDir, 'prepared.json')), null)
  } finally {
    await rm(config.rootDir, { recursive: true, force: true })
  }
})
