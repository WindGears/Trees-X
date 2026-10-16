import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { inspectApi, staticPath } from './readiness.mjs'

test('static references are constrained to unchanged same-origin paths', () => {
  const base = 'http://127.0.0.1:5181'
  assert.equal(staticPath('/models/a.glb', base), '/models/a.glb')
  for (const path of [
    'https://other.test/a',
    '//other.test/a',
    '/models/../a',
    '/a?password=x',
    '/a#b',
  ])
    assert.throws(() => staticPath(path, base))
})

test('readiness requires listed real API bindings, manifest digest and real production static files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trees-demo-readiness-'))
  const resources = {
    '/models/test/model.glb': Buffer.from('glTF-test'),
    '/covers/test.png': Buffer.from('cover-test'),
    '/draco/draco_wasm_wrapper.js': Buffer.from('decoder-test'),
    '/draco/draco_decoder.wasm': Buffer.from('wasm-test'),
    '/models/denoise/rt_hdr_alb_nrm.tza': Buffer.from('guided denoise weights'),
    '/models/denoise/LICENSE.txt': Buffer.from('Apache-2.0'),
    '/studio/amber-lounge/v1/lounge-panorama.png': Buffer.from('amber panorama'),
    '/studio/amber-lounge/v1/stone-basecolor.png': Buffer.from('stone basecolor'),
    '/studio/amber-lounge/v1/stone-roughness.png': Buffer.from('stone roughness'),
    '/studio/amber-lounge/v1/stone-normal.png': Buffer.from('stone normal'),
    '/studio/amber-lounge/spatial-v1/radial-distance.f32': Buffer.from('radial distance'),
    '/studio/amber-lounge/spatial-v1/DA2-LICENSE.txt': Buffer.from('Apache-2.0'),
    '/studio/amber-lounge/layers-v1/clean-room.png': Buffer.from('inferred clean room'),
    '/studio/amber-lounge/layers-v1/chair-table.png': Buffer.from('fixed chair and table RGBA'),
    '/studio/amber-lounge/layers-v1/table-lamp.png': Buffer.from('fixed table lamp RGBA'),
    '/index.html': Buffer.from('<script src="/assets/app.js"></script>'),
  }
  const manifest = Buffer.from(JSON.stringify({ files: [{ path: 'model.glb' }] }))
  resources['/models/test/manifest.json'] = manifest
  resources['/models/denoise/manifest.json'] = Buffer.from(
    JSON.stringify({ files: [{ path: 'rt_hdr_alb_nrm.tza' }, { path: 'LICENSE.txt' }] }),
  )
  for (const [pack, entry, paths] of [
    [
      'v1',
      'lounge-panorama.png',
      ['lounge-panorama.png', 'stone-basecolor.png', 'stone-roughness.png', 'stone-normal.png'],
    ],
    ['spatial-v1', 'radial-distance.f32', ['radial-distance.f32', 'DA2-LICENSE.txt']],
    ['layers-v1', 'clean-room.png', ['clean-room.png', 'chair-table.png', 'table-lamp.png']],
  ])
    resources['/studio/amber-lounge/' + pack + '/manifest.json'] = Buffer.from(
      JSON.stringify({ schemaVersion: 1, entry, files: paths.map((path) => ({ path })) }),
    )
  const detail = {
    slug: 'test',
    cover: '/covers/test.png',
    presentation: {
      source: {
        kind: 'glb',
        bundle: {
          manifest: '/models/test/manifest.json',
          sha256: createHash('sha256').update(manifest).digest('hex'),
        },
      },
    },
  }
  let listed = true
  let fallback = false
  const server = createServer(async (request, response) => {
    if (request.url === '/api/v1/products' || request.url === '/api/v1/products/test') {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify(request.url.endsWith('/test') ? detail : listed ? [{ slug: 'test' }] : []),
      )
      return
    }
    const path = request.url === '/' ? '/index.html' : request.url
    const bytes = resources[path]
    if (!bytes) {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('Content-Length', bytes.length)
    response.setHeader(
      'Content-Type',
      fallback && path === '/models/test/model.glb' ? 'text/html' : 'application/octet-stream',
    )
    response.end(request.method === 'HEAD' ? undefined : bytes)
  })
  try {
    for (const [path, bytes] of Object.entries(resources)) {
      const file = join(directory, path.slice(1))
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, bytes)
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const config = { distDir: directory, baseUrl: `http://127.0.0.1:${server.address().port}` }
    const products = [{ slug: 'test', manifest: '/models/test/manifest.json' }]
    const result = await inspectApi(config, products)
    assert.deepEqual(result.products, ['test'])
    assert.deepEqual(
      result.staticUrls,
      Object.keys(resources)
        .filter((path) => path !== '/index.html')
        .sort(),
    )
    for (const path of [
      '/studio/amber-lounge/spatial-v1/radial-distance.f32',
      '/studio/amber-lounge/layers-v1/clean-room.png',
      '/studio/amber-lounge/layers-v1/chair-table.png',
      '/studio/amber-lounge/layers-v1/table-lamp.png',
    ]) {
      const original = resources[path]
      delete resources[path]
      await assert.rejects(inspectApi(config, products), /HTTP 检查未通过/)
      resources[path] = original
    }
    for (const path of [
      '/studio/amber-lounge/spatial-v1/manifest.json',
      '/studio/amber-lounge/layers-v1/manifest.json',
    ]) {
      const original = resources[path]
      resources[path] = Buffer.from('{}')
      await assert.rejects(inspectApi(config, products), /资源清单与生产 dist 不一致/)
      resources[path] = original
    }
    listed = false
    await assert.rejects(inspectApi(config, products), /未上架/)
    listed = true
    const digest = detail.presentation.source.bundle.sha256
    detail.presentation.source.bundle.sha256 = '0'.repeat(64)
    await assert.rejects(inspectApi(config, products), /SHA-256/)
    detail.presentation.source.bundle.sha256 = digest
    fallback = true
    await assert.rejects(inspectApi(config, products), /生产 dist/)
    assert.equal((await readFile(join(directory, 'models/test/model.glb'))).toString(), 'glTF-test')
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
