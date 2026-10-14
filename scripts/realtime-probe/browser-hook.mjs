/* global window, btoa */

/** Disposable Playwright window only. Never installed by the product. */
export function installProbe() {
  const renderer = window.__demo.scene.renderer.instance,
    frame = renderer._nodes.nodeFrame,
    inspector = renderer._inspector,
    originalUpdate = frame.updateBeforeNode,
    originalFinish = inspector.finish
  if (!renderer.backend.isWebGPUBackend || !originalUpdate || !originalFinish)
    throw new Error('Inspected native r185 WebGPU frame hooks absent')
  const nodes = new Map()
  let pending,
    forceMiss = false
  const type = (node) => node.constructor.type
  frame.updateBeforeNode = function (node) {
    const result = originalUpdate.call(this, node)
    const kind = type(node)
    if (
      kind === 'SSRNode' ||
      kind === 'TemporalReprojectNode' ||
      (kind === 'RecurrentDenoiseNode' && node.mode === 'specular')
    )
      nodes.set(kind, { node, frameId: this.frameId })
    if (forceMiss && kind === 'SSRNode') {
      // An explicitly synthetic all-miss *signal* diagnostic. Existing scene,
      // G-buffer and native BRDF stay real; no result is a visitor screenshot.
      const target = node.getRenderTarget(),
        texture = renderer.backend.get(target.texture).texture,
        device = renderer.backend.device,
        encoder = device.createCommandEncoder(),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: texture.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 10000 },
            },
          ],
        })
      pass.end()
      device.queue.submit([encoder.finish()])
    }
    return result
  }
  const read = (name, target, textureIndex = 0) => {
    const width = target.width,
      height = target.height,
      texture = target.textures[textureIndex]
    const bytesPerTexel = texture.type === 1016 ? 8 : texture.type === 1009 ? 4 : null
    if (bytesPerTexel === null) throw new Error(`${name}: unexpected target component type`)
    const queued = renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, textureIndex)
    return queued.then((pixels) => {
      const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return {
        name,
        width,
        height,
        type: pixels.constructor.name,
        bytesPerRow: Math.ceil((width * bytesPerTexel) / 256) * 256,
        textureType: texture.type,
        gpuFormat: renderer.backend.get(texture).textureDescriptorGPU.format,
        textureUuid: texture.uuid,
        base64: btoa(binary),
      }
    })
  }
  inspector.finish = function (...args) {
    const result = originalFinish.apply(this, args)
    if (!pending) return result
    const request = pending
    pending = undefined
    try {
      const snapshot = window.__reflectionLighting.snapshot()
      if (
        snapshot.frames <= request.armed.frames ||
        snapshot.error ||
        snapshot.phase !== 'ready' ||
        snapshot.generation !== request.armed.generation ||
        snapshot.revision !== request.armed.revision
      )
        throw new Error('No successful current-product frame completed after arming the probe')
      const current = (kind) => {
        const entry = nodes.get(kind)
        return entry?.frameId === frame.frameId ? entry.node : undefined
      }
      const ssr = current('SSRNode'),
        temporal = current('TemporalReprojectNode'),
        filtered = current('RecurrentDenoiseNode')
      if (!ssr || !temporal || !filtered) throw new Error('Actual reflection resolve nodes absent')
      const surface = temporal.depthNode.passNode,
        surfaceTarget = surface.renderTarget,
        nativeIndex = surfaceTarget.textures.indexOf(surface.getTexture('baseSpecular'))
      if (nativeIndex < 0) throw new Error('Actual baseSpecular MRT attachment absent')
      // Queue all copies synchronously at one successful complete-frame boundary.
      // Async mapping does not alter the captured GPU submission or pause history.
      const queued = [
        read('ssr', ssr.getRenderTarget()),
        read('native', surfaceTarget, nativeIndex),
        read('replacement', filtered.getRenderTarget()),
        read('raw', temporal.beautyNode.renderTarget),
      ]
      const capturedFrame = window.__reflectionLighting.snapshot().frames
      Promise.all(queued).then(
        (signals) => request.resolve({ capturedFrame, forceMiss, signals }),
        request.reject,
      )
    } catch (error) {
      request.reject(error)
    }
    return result
  }
  window.__reflectionProbe = {
    forceMiss(value) {
      forceMiss = value
    },
    capture() {
      if (pending) throw new Error('A diagnostic readback is already pending')
      const armed = window.__reflectionLighting.snapshot()
      if (armed.phase !== 'ready' || armed.error || !armed.active)
        throw new Error('Probe requires a ready active realtime product')
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, armed }
      })
    },
    restore() {
      frame.updateBeforeNode = originalUpdate
      inspector.finish = originalFinish
      pending?.reject(new Error('Diagnostic cancelled'))
      pending = undefined
      return frame.updateBeforeNode === originalUpdate && inspector.finish === originalFinish
    },
  }
}
