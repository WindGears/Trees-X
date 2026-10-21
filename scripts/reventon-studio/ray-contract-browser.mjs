/* global window, btoa */

/** Test-only interception of existing frame nodes. No extra renderer or clock. */
export function installCarRayContractProbe() {
  const renderer = window.__demo.scene.renderer.instance,
    frame = renderer._nodes.nodeFrame,
    inspector = renderer._inspector,
    originalUpdate = frame.updateBeforeNode,
    originalFinish = inspector.finish,
    device = renderer.backend.device,
    labels = new Map()
  if (
    !renderer.backend.isWebGPUBackend ||
    typeof originalUpdate !== 'function' ||
    typeof originalFinish !== 'function' ||
    !device
  )
    throw new Error('Inspected native r185 WebGPU frame hooks absent')
  let pending,
    inFlight = false,
    stopped = false
  const read = (name, target, rectangle, textureIndex = 0) => {
    const texture = target.textures[textureIndex],
      { x, y, width, height } = rectangle
    if (texture.type !== 1016) throw new Error(name + ': expected an actual RGBA16F target')
    const queued = renderer.readRenderTargetPixelsAsync(target, x, y, width, height, textureIndex)
    return queued.then((pixels) => {
      const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return {
        name,
        ...rectangle,
        type: pixels.constructor.name,
        bytesPerRow: Math.ceil((width * 8) / 256) * 256,
        textureType: texture.type,
        gpuFormat: renderer.backend.get(texture).textureDescriptorGPU.format,
        textureUuid: texture.uuid,
        base64: btoa(binary),
      }
    })
  }
  const fail = (error) => {
    const request = pending
    pending = undefined
    inFlight = false
    request?.reject(error)
  }
  const update = function (node) {
    const noiseBefore = node._noiseIndex?.value,
      result = originalUpdate.call(this, node)
    if (!pending) return result
    try {
      const type = node.type ?? node.constructor.type
      if (type === 'SSRNode' && node._noiseIndex?.value !== noiseBefore) {
        if (!labels.has(node)) labels.set(node, labels.size)
        const label = labels.get(node)
        if (label > 1) throw new Error('Unexpected third native SSR node')
        const target = node.getRenderTarget(),
          texture = renderer.backend.get(target.texture).texture,
          encoder = device.createCommandEncoder(),
          ray = pending.rays[label],
          pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: texture.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: ray[0], g: ray[1], b: ray[2], a: ray[3] },
              },
            ],
          })
        pass.end()
        device.queue.submit([encoder.finish()])
        pending.executed.set(label, {
          node,
          frameId: frame.frameId,
          noiseIndex: node._noiseIndex.value,
          targetUuid: target.texture.uuid,
        })
      }
      if (type === 'RTTNode' && node.value.name === 'TreesX.Reflection.rawDelta')
        pending.raw = { node, frameId: frame.frameId }
    } catch (error) {
      fail(error)
    }
    return result
  }
  const finish = function (...args) {
    const result = originalFinish.apply(this, args)
    if (!pending) return result
    const request = pending
    try {
      const snapshot = window.__carLighting.snapshot()
      if (
        snapshot.frames <= request.armed.frames ||
        snapshot.error ||
        snapshot.phase !== 'ready' ||
        snapshot.generation !== request.armed.generation ||
        snapshot.revision !== request.armed.revision
      )
        throw new Error('No successful current-product frame completed after arming')
      const rays = [...request.executed.entries()].sort(([a], [b]) => a - b)
      if (
        rays.length !== 2 ||
        rays.some(([, value]) => value.frameId !== frame.frameId) ||
        request.raw?.frameId !== frame.frameId
      )
        throw new Error('Both actual SSR nodes and rawDelta must execute in the captured frame')
      const surface = rays[0][1].node.depthNode.passNode,
        nativeIndex = surface.renderTarget.textures.indexOf(surface.getTexture('baseSpecular')),
        target = request.raw.node.renderTarget,
        rectangle = {
          x: Math.max(0, Math.floor(target.width / 2) - 256),
          y: Math.max(0, Math.floor(target.height / 2) - 256),
          width: Math.min(512, target.width),
          height: Math.min(512, target.height),
        }
      if (
        nativeIndex < 0 ||
        surface.renderTarget.width !== target.width ||
        surface.renderTarget.height !== target.height
      )
        throw new Error('Matching real native baseSpecular and rawDelta targets absent')
      const capturedNativeFrameId = frame.frameId,
        queued = [
          read('native', surface.renderTarget, rectangle, nativeIndex),
          read('rawDelta', target, rectangle),
          ...rays.map(([label, entry]) =>
            read('ray-' + label, entry.node.getRenderTarget(), rectangle),
          ),
        ]
      pending = undefined
      Promise.all(queued).then(
        (signals) => {
          inFlight = false
          request.resolve({
            id: request.id,
            armedFrame: request.armed.frames,
            completedFrame: snapshot.frames,
            nativeFrameId: capturedNativeFrameId,
            generation: snapshot.generation,
            revision: snapshot.revision,
            rectangle,
            rays: rays.map(([label, entry]) => ({
              label,
              noiseIndex: entry.noiseIndex,
              targetUuid: entry.targetUuid,
              uuid: entry.node.uuid,
            })),
            signals,
          })
        },
        (error) => {
          inFlight = false
          request.reject(error)
        },
      )
    } catch (error) {
      fail(error)
    }
    return result
  }
  frame.updateBeforeNode = update
  inspector.finish = finish
  window.__carRayContract = {
    capture(test) {
      if (stopped || inFlight) throw new Error('Probe stopped or a capture is already pending')
      const armed = window.__carLighting.snapshot()
      if (armed.phase !== 'ready' || armed.error || !armed.active)
        throw new Error('Probe requires a ready active real product')
      inFlight = true
      return new Promise((resolve, reject) => {
        pending = { ...test, armed, resolve, reject, executed: new Map() }
      })
    },
    restore() {
      stopped = true
      if (frame.updateBeforeNode === update) frame.updateBeforeNode = originalUpdate
      if (inspector.finish === finish) inspector.finish = originalFinish
      fail(new Error('Diagnostic capture cancelled'))
      labels.clear()
      return frame.updateBeforeNode === originalUpdate && inspector.finish === originalFinish
    },
  }
}
