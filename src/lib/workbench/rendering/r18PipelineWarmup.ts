import { REVISION } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { sha256 } from '../assetBundle'
import { isAuditedReventonSource, reventonRuntimeBundle } from '../reventonCandidate'
import type { ProductPresentation } from '../types'
import { r18PerformanceEnabled } from './showcase'

type Descriptor = Record<string, unknown>

interface CapturedPipeline extends Descriptor {
  layout: Descriptor & { bindGroupLayouts: (Descriptor | null)[] }
  vertex: Descriptor & { module: Descriptor }
  fragment: Descriptor & { module: Descriptor }
}

interface PipelineDevice {
  createShaderModule(descriptor: Descriptor): object
  createBindGroupLayout(descriptor: Descriptor): object
  createPipelineLayout(descriptor: Descriptor): object
  createRenderPipelineAsync(descriptor: Descriptor): Promise<object>
  pushErrorScope(filter: 'validation'): void
  popErrorScope(): Promise<object | null>
}

interface PipelineCache {
  version: 1
  three: number
  bundleSha256: string
  count: number
  bytes: number
  sha256: string
}

const local = import.meta.glob<PipelineCache>('../reventonNativePipelineCache.json', {
  eager: true,
  import: 'default',
})
const pending = new WeakSet<PipelineDevice>()
const prepared = new WeakSet<PipelineDevice>()

function nativeCompiler(value: unknown): value is PipelineDevice {
  return (
    !!value &&
    typeof value === 'object' &&
    [
      'createShaderModule',
      'createBindGroupLayout',
      'createPipelineLayout',
      'createRenderPipelineAsync',
      'pushErrorScope',
      'popErrorScope',
    ].every((method) => typeof Reflect.get(value, method) === 'function')
  )
}

async function compile(device: PipelineDevice, records: CapturedPipeline[]) {
  const shaders = new Map<string, object>(),
    groups = new Map<string, object>(),
    layouts = new Map<string, object>()
  const memo = (
    map: Map<string, object>,
    descriptor: Descriptor,
    create: (value: Descriptor) => object,
  ) => {
    const key = JSON.stringify(descriptor)
    let value = map.get(key)
    if (!value) map.set(key, (value = create(descriptor)))
    return value
  }
  const stage = (value: CapturedPipeline['vertex']) => ({
    ...value,
    module: memo(shaders, value.module, (entry) => device.createShaderModule(entry)),
  })
  const layout = (value: CapturedPipeline['layout']) =>
    memo(layouts, value, () =>
      device.createPipelineLayout({
        ...value,
        bindGroupLayouts: value.bindGroupLayouts.map((group) =>
          group === null
            ? null
            : memo(groups, group, (entry) => device.createBindGroupLayout(entry)),
        ),
      }),
    )
  // The scope covers only this synchronous batch. Later scene submissions have
  // their own scopes. Native compilation can continue independently of loading.
  device.pushErrorScope('validation')
  const jobs = records.map(async (record) =>
    device.createRenderPipelineAsync({
      ...record,
      layout: layout(record.layout),
      vertex: stage(record.vertex),
      fragment: stage(record.fragment),
    }),
  )
  const [validation, results] = await Promise.all([
    device.popErrorScope(),
    Promise.allSettled(jobs),
  ])
  return validation
    ? []
    : results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

/** Prepopulate the same device's native cache while the R18 bundle is loading. */
export function warmR18StartupPipelines(
  renderer: WebGPURenderer,
  source: ProductPresentation['source'],
  search: string,
  signal: AbortSignal,
) {
  const record = local['../reventonNativePipelineCache.json'],
    query = new URLSearchParams(search)
  if (
    signal.aborted ||
    !r18PerformanceEnabled(search) ||
    query.get('r18Pso') === 'off' ||
    query.get('reventonAsset') !== 'runtime-v2' ||
    query.get('carRenderTuning') === 'legacy' ||
    source.kind !== 'glb' ||
    !isAuditedReventonSource(source) ||
    REVISION !== '185' ||
    record?.version !== 1 ||
    record.three !== 185 ||
    record.bundleSha256 !== reventonRuntimeBundle?.sha256 ||
    !Number.isSafeInteger(record.count) ||
    record.count < 1 ||
    record.count > 128 ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    !/^[a-f0-9]{64}$/.test(record.sha256)
  )
    return
  const device: unknown = Reflect.get(renderer.backend, 'device')
  if (!nativeCompiler(device) || pending.has(device) || prepared.has(device)) return
  pending.add(device)
  const request = new AbortController(),
    retained: object[] = []
  const release = () => {
    request.abort()
    signal.removeEventListener('abort', release)
    retained.length = 0
  }
  signal.addEventListener('abort', release, { once: true })
  void (async () => {
    try {
      const response = await fetch(
        `/models/reventon-runtime-v2/native-pipelines/${record.sha256}.bin`,
        { signal: request.signal, mode: 'same-origin', redirect: 'error' },
      )
      if (!response.ok) return
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== record.bytes || (await sha256(bytes)) !== record.sha256) return
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      const data: { version: number; records: CapturedPipeline[] } = await new Response(
        stream,
      ).json()
      if (
        data.version !== 1 ||
        !Array.isArray(data.records) ||
        data.records.length !== record.count
      )
        return
      request.signal.throwIfAborted()
      const pipelines = await compile(device, data.records)
      if (request.signal.aborted) return
      // Keep native handles until Three has submitted its first real frame.
      retained.push(...pipelines)
      if (pipelines.length === record.count) prepared.add(device)
    } catch {
      // A stale or unsupported warmup leaves native scene compilation intact.
    } finally {
      pending.delete(device)
    }
  })()
  return release
}
