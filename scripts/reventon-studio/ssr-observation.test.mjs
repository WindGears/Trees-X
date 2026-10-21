import assert from 'node:assert/strict'
import test from 'node:test'
import { assertExecutedSsr, installSsrObservation } from './ssr-observation.mjs'

function fixture() {
  let completed = 0
  const nodeFrame = {
    frameId: 1,
    updateBeforeNode(node) {
      if (node.type !== 'SSRNode' || node.lastFrame === this.frameId) return
      node.lastFrame = this.frameId
      node._noiseIndex.value = (node._noiseIndex.value + 1) % 2147483647
    },
  }
  const original = nodeFrame.updateBeforeNode
  const environment = {
    __demo: { scene: { renderer: { instance: { _nodes: { nodeFrame } } } } },
    __carLighting: { snapshot: () => ({ frames: completed }) },
  }
  const ray = (uuid, index) => ({
    type: 'SSRNode',
    uuid,
    _noiseIndex: { value: index },
    getRenderTarget: () => ({ texture: { uuid: 'target-' + uuid } }),
  })
  installSsrObservation(environment)
  return { environment, frame: nodeFrame, original, ray, complete: () => completed++ }
}

test('execution observation waits for complete scene, deduplicates native calls and restores hook', () => {
  const test = fixture()
  const first = test.ray('first', 0),
    second = test.ray('second', 104729)
  test.frame.updateBeforeNode(first)
  test.frame.updateBeforeNode(second)
  test.frame.updateBeforeNode(first)
  const observer = test.environment.__carSsrObservation
  assert.equal(observer.read().lastComplete, null)
  test.complete()
  assertExecutedSsr(observer.read(), 2)
  assert.equal(observer.read().observedUpdates, 2)
  assert.equal(observer.read().repeatedCalls, 1)
  test.frame.frameId++
  test.frame.updateBeforeNode({ type: 'Other' })
  test.complete()
  assert.equal(
    observer.read().lastComplete.nodeFrameId,
    1,
    'No SSR frame retains actual last complete',
  )
  assert.equal(observer.stop().restored, true)
  assert.equal(test.frame.updateBeforeNode, test.original)
})

test('configured seeds cannot substitute executed independent targets / indices', () => {
  const test = fixture()
  const first = test.ray('first', 2147483646),
    second = test.ray('second', 104728)
  test.frame.updateBeforeNode(first)
  test.frame.updateBeforeNode(second)
  test.complete()
  const observed = test.environment.__carSsrObservation.read()
  assertExecutedSsr(observed, 2)
  observed.lastComplete.rays[1].noiseIndex = 0
  assert.throws(() => assertExecutedSsr(observed, 2))
  observed.lastComplete.rays[1].noiseIndex = 104729
  observed.lastComplete.rays[1].targetUuid = observed.lastComplete.rays[0].targetUuid
  assert.throws(() => assertExecutedSsr(observed, 2))
})
