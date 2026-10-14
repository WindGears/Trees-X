/* global window, atob, btoa */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const require = createRequire(import.meta.url)
const xatlasDirectory = dirname(require.resolve('xatlas-web'))

function encode(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64')
}

function decode(encoded, Constructor) {
  const buffer = Buffer.from(encoded, 'base64')
  const copied = new Uint8Array(buffer.length)
  copied.set(buffer)
  return new Constructor(copied.buffer)
}

function validateInput(geometry) {
  const { mesh, positions, normals, indices } = geometry
  if (!Number.isInteger(mesh) || mesh < 0)
    throw new Error('UV input requires a nonnegative mesh ID')
  if (!(positions instanceof Float32Array) || positions.length % 3 || !positions.length) {
    throw new Error(`Mesh ${mesh}: expected nonempty Float32Array positions`)
  }
  if (!(normals instanceof Float32Array) || normals.length !== positions.length) {
    throw new Error(`Mesh ${mesh}: normals must match positions`)
  }
  if (!(indices instanceof Uint32Array) || indices.length % 3 || !indices.length) {
    throw new Error(`Mesh ${mesh}: expected Uint32Array triangle indices`)
  }
  const vertexCount = positions.length / 3
  // The installed 0.1.0 C++ wrapper explicitly declares UInt16 input indices.
  if (vertexCount > 65536)
    throw new Error(`Mesh ${mesh}: xatlas-web 0.1.0 only accepts UInt16 indices`)
  for (const value of positions)
    if (!Number.isFinite(value)) throw new Error(`Mesh ${mesh}: invalid position`)
  for (const value of normals)
    if (!Number.isFinite(value)) throw new Error(`Mesh ${mesh}: invalid normal`)
  for (const value of indices)
    if (value >= vertexCount) throw new Error(`Mesh ${mesh}: out-of-range index`)
}

function metricUvScale(geometry, output) {
  let modelArea = 0
  let uvArea = 0
  for (let corner = 0; corner < geometry.indices.length; corner += 3) {
    const a = geometry.indices[corner] * 3
    const b = geometry.indices[corner + 1] * 3
    const c = geometry.indices[corner + 2] * 3
    const p = geometry.positions
    const x1 = p[b] - p[a],
      y1 = p[b + 1] - p[a + 1],
      z1 = p[b + 2] - p[a + 2]
    const x2 = p[c] - p[a],
      y2 = p[c + 1] - p[a + 1],
      z2 = p[c + 2] - p[a + 2]
    modelArea += Math.hypot(y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2) * 0.5
    const ua = output.indices[corner] * 2
    const ub = output.indices[corner + 1] * 2
    const uc = output.indices[corner + 2] * 2
    const uv = output.uv
    uvArea +=
      Math.abs(
        (uv[ub] - uv[ua]) * (uv[uc + 1] - uv[ua + 1]) -
          (uv[ub + 1] - uv[ua + 1]) * (uv[uc] - uv[ua]),
      ) * 0.5
  }
  if (!(modelArea > 0) || !(uvArea > 0))
    throw new Error(`Mesh ${geometry.mesh}: degenerate UV atlas`)
  // Convert atlas coordinates to model-unit density for shared repeating microtextures.
  // This is area calibration, not a guarantee of zero per-chart distortion.
  return Math.sqrt(modelArea / uvArea)
}

/**
 * Offline xatlas-web 0.1.0 unwrapping. A temporary CPU-only browser owns the
 * WASM heap, including allocations the legacy wrapper does not expose for free.
 * No source geometry, runtime scene, Canvas or GPU renderer is created here.
 * Returned UVs have area-calibrated model-unit density, rather than decal UVs.
 */
export async function unwrapGeometries(geometries, options = {}) {
  if (!Array.isArray(geometries)) throw new Error('Expected an array of geometries')
  if (!geometries.length) return []
  const ids = new Set()
  for (const geometry of geometries) {
    validateInput(geometry)
    if (ids.has(geometry.mesh)) throw new Error(`Duplicate mesh ${geometry.mesh}`)
    ids.add(geometry.mesh)
  }
  const [script, wasm] = await Promise.all([
    readFile(join(xatlasDirectory, 'xatlas-web.js')),
    readFile(join(xatlasDirectory, 'xatlas-web.wasm')),
  ])
  const files = new Map([
    ['/', ['text/html', Buffer.from('<!doctype html><script src="/xatlas-web.js"></script>')]],
    ['/xatlas-web.js', ['text/javascript', script]],
    ['/xatlas-web.wasm', ['application/wasm', wasm]],
  ])
  const server = createServer((request, response) => {
    const file = files.get(request.url)
    response.writeHead(file ? 200 : 404, {
      'Content-Type': file?.[0] ?? 'text/plain',
      'Cache-Control': 'no-store',
    })
    response.end(file?.[1] ?? 'Not found')
  })
  let browser
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Could not start offline UV worker')
    const origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({
      channel: options.channel ?? 'msedge',
      headless: true,
      args: ['--disable-gpu', '--disable-software-rasterizer'],
    })
    const page = await browser.newPage()
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith(`${origin}/`)) return route.continue()
      return route.abort('blockedbyclient')
    })
    await page.goto(origin)
    const inputs = geometries.map((geometry) => ({
      mesh: geometry.mesh,
      positions: encode(geometry.positions),
      normals: encode(geometry.normals),
      indices: encode(geometry.indices),
    }))
    const encodedOutputs = await page.evaluate(async (inputs) => {
      function fromBase64(encoded, Constructor) {
        const binary = atob(encoded)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new Constructor(bytes.buffer)
      }
      function toBase64(array) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
        const chunks = []
        for (let start = 0; start < bytes.length; start += 32768) {
          chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)))
        }
        return btoa(chunks.join(''))
      }
      const module = window.Module({ locateFile: (name) => `/${name}` })
      await module.ready
      const outputs = []
      // One mesh at a time keeps the old wrapper's WASM working set bounded.
      // Closing the browser reclaims the wrapper's unexposed allocations.
      for (const input of inputs) {
        module.createAtlas()
        try {
          const positions = fromBase64(input.positions, Float32Array)
          const normals = fromBase64(input.normals, Float32Array)
          const indices = fromBase64(input.indices, Uint32Array)
          const buffers = module.createMesh(positions.length / 3, indices.length, true, false)
          module.HEAPF32.set(positions, buffers.positionOffset / 4)
          module.HEAPF32.set(normals, buffers.normalOffset / 4)
          module.HEAPU16.set(indices, buffers.indexOffset / 2)
          const status = module.addMesh()
          if (status !== 0) throw new Error(`Mesh ${input.mesh}: xatlas AddMesh error ${status}`)
          module.generateAtlas()
          const output = module.getMeshData(0)
          outputs.push({
            mesh: input.mesh,
            remap: toBase64(
              module.HEAPU32.slice(
                output.originalIndexOffset / 4,
                output.originalIndexOffset / 4 + output.newVertexCount,
              ),
            ),
            indices: toBase64(
              module.HEAPU32.slice(
                output.indexOffset / 4,
                output.indexOffset / 4 + output.newIndexCount,
              ),
            ),
            uv: toBase64(
              module.HEAPF32.slice(
                output.uvOffset / 4,
                output.uvOffset / 4 + output.newVertexCount * 2,
              ),
            ),
          })
        } finally {
          module.destroyAtlas()
        }
      }
      return outputs
    }, inputs)
    return encodedOutputs.map((encoded, index) => {
      const geometry = geometries[index]
      const output = {
        mesh: encoded.mesh,
        remap: decode(encoded.remap, Uint32Array),
        indices: decode(encoded.indices, Uint32Array),
        uv: decode(encoded.uv, Float32Array),
      }
      if (output.indices.length !== geometry.indices.length)
        throw new Error(`Mesh ${output.mesh}: triangle count changed`)
      if (output.uv.length !== output.remap.length * 2)
        throw new Error(`Mesh ${output.mesh}: incomplete UVs`)
      for (const value of output.remap) {
        if (value >= geometry.positions.length / 3)
          throw new Error(`Mesh ${output.mesh}: invalid vertex remap`)
      }
      for (let corner = 0; corner < geometry.indices.length; corner++) {
        if (output.remap[output.indices[corner]] !== geometry.indices[corner]) {
          throw new Error(`Mesh ${output.mesh}: xatlas changed corner order at ${corner}`)
        }
      }
      for (const value of output.uv)
        if (!Number.isFinite(value)) throw new Error(`Mesh ${output.mesh}: invalid UV`)
      const scale = metricUvScale(geometry, output)
      for (let i = 0; i < output.uv.length; i++) output.uv[i] *= scale
      return output
    })
  } finally {
    await Promise.allSettled([browser?.close(), new Promise((resolve) => server.close(resolve))])
  }
}
