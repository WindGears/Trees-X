/* global window */

/** Test-window only. Observe the existing r185 NodeFrame entry; do not invoke a
 * node, create another scheduler, read GPU pixels, or change noise uniforms.
 */
export function installSsrObservation(environment = window) {
  const renderer = environment.__demo.scene.renderer.instance
  const frame = renderer._nodes?.nodeFrame
  const original = frame?.updateBeforeNode
  if (typeof original !== 'function') throw new Error('Native NodeFrame observation is unavailable')
  const pending = new Map()
  let last = null,
    observedUpdates = 0,
    repeatedCalls = 0,
    stopped = false
  const read = () => {
    const completed = environment.__carLighting.snapshot().frames
    for (const [id, bucket] of pending) {
      if (completed <= bucket.beforeSceneFrame) continue
      last = {
        nodeFrameId: id,
        completedSceneFrame: bucket.beforeSceneFrame + 1,
        rays: [...bucket.rays.values()],
      }
      pending.delete(id)
    }
    return {
      enabled: true,
      stopped,
      observedUpdates,
      repeatedCalls,
      pendingFrames: pending.size,
      lastComplete: last,
      method:
        'Existing r185 NodeFrame.updateBeforeNode after native SSR update changed _noiseIndex; distinct native nodes / output targets grouped by native frameId and accepted only after coordinator frames commit. No GPU pixel readback.',
    }
  }
  const wrapper = function (node) {
    if (node?.type !== 'SSRNode') return original.call(this, node)
    const id = this.frameId
    const noiseBefore = node._noiseIndex?.value
    const beforeSceneFrame = environment.__carLighting.snapshot().frames
    const result = original.call(this, node)
    const noiseIndex = node._noiseIndex?.value
    if (noiseIndex === noiseBefore) {
      repeatedCalls++
      return result
    }
    const targetUuid = node.getRenderTarget?.().texture?.uuid
    if (!Number.isSafeInteger(noiseIndex) || !node.uuid || !targetUuid)
      throw new Error('Native SSR execution observation contract changed')
    let bucket = pending.get(id)
    if (!bucket) {
      bucket = { beforeSceneFrame, rays: new Map() }
      pending.set(id, bucket)
    }
    if (!bucket.rays.has(node.uuid)) {
      bucket.rays.set(node.uuid, { uuid: node.uuid, noiseIndex, targetUuid })
      observedUpdates++
    } else repeatedCalls++
    // Bound retained diagnostic state even if the page stops polling. Accepted
    // lastComplete remains unchanged across native frames containing no SSR draw.
    if (pending.size > 32) read()
    return result
  }
  frame.updateBeforeNode = wrapper
  environment.__carSsrObservation = {
    read,
    stop() {
      if (frame.updateBeforeNode === wrapper) frame.updateBeforeNode = original
      stopped = true
      return { ...read(), restored: frame.updateBeforeNode === original }
    },
  }
}

export function assertExecutedSsr(observation, expected) {
  const last = observation?.lastComplete
  if (
    !last ||
    !Number.isSafeInteger(last.nodeFrameId) ||
    !Number.isSafeInteger(last.completedSceneFrame)
  )
    throw new Error('No completed native SSR execution frame was observed')
  if (
    last.rays.length !== expected ||
    new Set(last.rays.map((ray) => ray.uuid)).size !== expected ||
    new Set(last.rays.map((ray) => ray.targetUuid)).size !== expected
  )
    throw new Error('Expected distinct actually executed SSR instances and native output targets')
  if (expected === 2) {
    const modulus = 2147483647
    const difference = (last.rays[1].noiseIndex - last.rays[0].noiseIndex + modulus) % modulus
    if (difference !== 104729 && difference !== modulus - 104729)
      throw new Error('Actually executed native SSR noise indices are not independent by 104729')
  }
}
