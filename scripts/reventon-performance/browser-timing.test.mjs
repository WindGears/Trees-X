/* global window, queueMicrotask */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { installCompletedFrameTiming, installGpuSampler } from './browser-timing.mjs'

const microtasks = () => new Promise(queueMicrotask)

async function frameTiming(run, render) {
  const previousWindow = globalThis.window,
    status = { frames: 0 },
    calls = [],
    lighting = { snapshot: () => ({ ...status }), setSignals() {} },
    renderer = {
      target: null,
      getRenderTarget() {
        return this.target
      },
      render(...args) {
        calls.push({ receiver: this, args })
        return render ? render.apply(this, args) : 'native-render-result'
      },
    },
    original = renderer.render
  globalThis.window = {
    __carLighting: lighting,
    __demo: { scene: { renderer: { instance: renderer } } },
  }
  let timing
  try {
    installCompletedFrameTiming()
    timing = window.__carFrameTiming
    await run({ status, calls, lighting, renderer, original, timing })
  } finally {
    timing?.stop()
    globalThis.window = previousWindow
  }
}

describe('completed coordinator frame instrumentation', () => {
  it('observes successful final canvas commits through a snapshot-only lighting facade', async () => {
    await frameTiming(async ({ status, calls, lighting, renderer, original, timing }) => {
      assert.equal(lighting.render, undefined)
      timing.segment('doors')
      assert.equal(renderer.render('scene', 'camera'), 'native-render-result')
      // Like coordinator.draw(), the commit/counter increment follows render().
      status.frames++
      timing.segment('between-sequences')
      await microtasks()
      timing.segment('separation')
      renderer.render('scene', 'camera')
      status.frames++
      await microtasks()
      const result = timing.stop()
      assert.equal(result.completions.length, 2)
      assert.equal(result.completions[0].segment, 'doors')
      assert.equal(result.completions[1].frame, 2)
      assert.equal(result.completions[1].segment, 'separation')
      assert.equal(result.completions[0].skippedCounterValues, 0)
      assert.ok(result.completions[1].atMs >= result.completions[0].atMs)
      assert.equal(result.restored, true)
      assert.equal(renderer.render, original)
      assert.equal(calls[0].receiver, renderer)
      assert.deepEqual(calls[0].args, ['scene', 'camera'])
      assert.match(result.method, /microtask/)
      assert.match(result.method, /not a direct notify hook/)
    })
  })

  it('excludes offscreen draws and nested reflection/shadow renders', async () => {
    await frameTiming(
      async ({ status, renderer, timing, calls }) => {
        renderer.target = { name: 'surface-target' }
        renderer.render('surface')
        // An unrelated observed counter change must not turn an RTT into a frame.
        status.frames = 1
        await microtasks()
        renderer.target = null
        renderer.render('canvas')
        status.frames = 2
        await microtasks()
        const result = timing.stop()
        assert.deepEqual(
          calls.map((call) => call.args[0]),
          ['surface', 'canvas', 'reflection', 'shadow'],
        )
        assert.deepEqual(
          result.completions.map((entry) => entry.frame),
          [2],
        )
        assert.equal(result.completions[0].skippedCounterValues, 1)
      },
      function (scene) {
        if (scene !== 'canvas') return
        this.target = { name: 'reflection-target' }
        this.render('reflection')
        this.target = { name: 'shadow-target' }
        this.render('shadow')
        this.target = null
      },
    )
  })

  it('ignores renderer throws, failed later commits and unchanged frame counters', async () => {
    await frameTiming(
      async ({ status, renderer, timing }) => {
        timing.segment('failed-render')
        assert.throws(() => renderer.render('throw'), /native-render-failure/)
        await microtasks()
        timing.segment('failed-commit')
        renderer.render('canvas')
        // A later coordinator commit failure leaves the success counter unchanged.
        await microtasks()
        timing.segment('success')
        renderer.render('canvas')
        status.frames++
        await microtasks()
        timing.segment('unchanged-counter')
        renderer.render('canvas')
        await microtasks()
        const result = timing.stop()
        assert.equal(result.completions.length, 1)
        assert.equal(result.completions[0].segment, 'success')
        assert.equal(result.completions[0].frame, 1)
      },
      (scene) => {
        if (scene === 'throw') throw new Error('native-render-failure')
      },
    )
  })

  it('observes the final synchronous draw only after an asynchronous frame dependency resolves', async () => {
    await frameTiming(async ({ status, calls, renderer, timing }) => {
      let resolveTick
      const tick = new Promise((accept) => {
        resolveTick = accept
      })
      const draw = async () => {
        await tick
        renderer.render('canvas')
        status.frames++
      }
      timing.segment('awaited-ddgi-frame')
      const pendingFrame = draw()
      await microtasks()
      assert.equal(calls.length, 0)
      assert.equal(status.frames, 0)
      resolveTick()
      await pendingFrame
      await microtasks()
      const result = timing.stop()
      assert.equal(result.completions.length, 1)
      assert.equal(result.completions[0].segment, 'awaited-ddgi-frame')
      assert.equal(result.completions[0].frame, 1)
    })
  })

  it('deduplicates nested canvas candidates that share one completed coordinator counter', async () => {
    await frameTiming(
      async ({ status, renderer, timing }) => {
        renderer.render('outer-canvas')
        status.frames++
        await microtasks()
        assert.equal(timing.stop().completions.length, 1)
      },
      function (scene) {
        if (scene === 'outer-canvas') this.render('inner-canvas')
      },
    )
  })

  it('stop restores the renderer and prevents pending microtasks from changing returned results', async () => {
    await frameTiming(async ({ status, renderer, original, timing }) => {
      renderer.render('canvas')
      status.frames++
      const result = timing.stop()
      assert.equal(renderer.render, original)
      assert.equal(result.restored, true)
      assert.equal(window.__carFrameTiming, undefined)
      assert.deepEqual(result.completions, [])
      await microtasks()
      assert.deepEqual(result.completions, [])
      renderer.render('canvas')
      status.frames++
      await microtasks()
      assert.deepEqual(result.completions, [])
    })
  })

  it('does not overwrite a renderer wrapper installed by another owner', async () => {
    await frameTiming(async ({ renderer, timing }) => {
      const replacement = () => 'another-owner'
      renderer.render = replacement
      const result = timing.stop()
      assert.equal(result.restored, false)
      assert.equal(renderer.render, replacement)
    })
  })
  it('reports unsupported timestamps without synthesizing GPU data', async () => {
    const beginRender = () => {},
      beginCompute = () => {},
      query = () => {},
      backend = {
        beginRender,
        beginCompute,
        initTimestampQuery: query,
        device: { features: new Set() },
      },
      previousWindow = globalThis.window
    globalThis.window = { __demo: { scene: { renderer: { instance: { backend } } } } }
    try {
      const installed = installGpuSampler()
      assert.equal(installed.supported, false)
      const result = await window.__carGpuTiming.stop()
      assert.deepEqual(result.samples, [])
      assert.deepEqual(result.errors, [])
      assert.equal(result.restored, true)
      assert.equal(backend.beginRender, beginRender)
    } finally {
      globalThis.window = previousWindow
    }
  })
  it('preserves native pass labels and resolves GPU durations independently of JS frame callbacks', async () => {
    const pools = {
        render: { currentQueryIndex: 2, timestamps: new Map([['r:1:4:f10', 2.5]]) },
        compute: { currentQueryIndex: 2, timestamps: new Map([['c:2:9:f10', 3.5]]) },
      },
      backend = {
        trackTimestamp: true,
        device: { features: new Set(['timestamp-query']) },
        timestampQueryPool: pools,
        beginRender(context) {
          this.initTimestampQuery('render', 'r:1:4:f10', { label: context.name })
        },
        beginCompute(group) {
          this.initTimestampQuery('compute', 'c:2:9:f10', { label: group.name })
        },
        initTimestampQuery() {},
      },
      renderer = {
        backend,
        domElement: { width: 1440, height: 1000 },
        async resolveTimestampsAsync(type) {
          pools[type].currentQueryIndex = 0
        },
      },
      previousWindow = globalThis.window,
      originalRender = backend.beginRender
    globalThis.window = { __demo: { scene: { renderer: { instance: renderer } } } }
    try {
      assert.equal(installGpuSampler().supported, true)
      window.__carGpuTiming.segment('round-1-orbit')
      backend.beginRender({
        id: 4,
        name: 'surface',
        renderTarget: { width: 1440, height: 1000, texture: { name: 'surface' } },
        textures: [{ name: 'normal' }],
      })
      backend.beginCompute({ id: 9, name: 'DDGI solve' })
      const result = await window.__carGpuTiming.stop()
      assert.equal(result.samples.length, 2)
      assert.equal(result.samples[0].durationMs, 2.5)
      assert.equal(result.samples[0].label.target, 'surface')
      assert.equal(result.samples[0].segment, 'round-1-orbit')
      assert.equal(result.samples[1].label.name, 'DDGI solve')
      assert.equal(result.restored, true)
      assert.equal(backend.beginRender, originalRender)
    } finally {
      globalThis.window = previousWindow
    }
  })
})
