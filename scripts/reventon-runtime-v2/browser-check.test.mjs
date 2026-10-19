import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachFixtureRuntime,
  fixturePath,
  fixtureRequest,
  runMaterialComparison,
} from './browser-check.mjs'

test('fixture path excludes masters, traversal, absolute and sibling files', () => {
  const prefix = 'artifacts/car-runtime-v2/material-comparison/'
  assert.ok(
    fixturePath(process.cwd(), prefix + 'seat-cushion/original/model.glb').endsWith('model.glb'),
  )
  for (const path of [
    'public/models/reventon/reventon.glb',
    prefix + '../report.json',
    '../models',
    '/artifacts/test.json',
    'artifacts/car-runtime-v2/representative-uastc-q4/seat-color.ktx2',
  ])
    assert.throws(() => fixturePath(process.cwd(), path))
})

test('routes only the selected API detail and registered same-origin fixture bytes', () => {
  const origin = 'http://127.0.0.1:5181',
    file = { path: 'artifacts/car-runtime-v2/material-comparison/test/model.glb' },
    files = new Map([['/' + file.path, file]])
  assert.equal(
    fixtureRequest(origin, origin + '/api/v1/products/reventon', 'GET', files).action,
    'product',
  )
  assert.deepEqual(fixtureRequest(origin, origin + '/' + file.path, 'GET', files), {
    action: 'file',
    file,
  })
  assert.equal(fixtureRequest(origin, origin + '/api/v1/products', 'GET', files).action, 'continue')
  assert.equal(fixtureRequest(origin, origin + '/assets/app.js', 'GET', files).action, 'continue')
  assert.equal(
    fixtureRequest(origin, origin + '/basis/basis_transcoder.wasm', 'GET', files).action,
    'continue',
  )
  assert.equal(
    fixtureRequest(origin, origin + '/models/reventon/reventon.glb', 'GET', files).action,
    'reject',
  )
  assert.equal(
    fixtureRequest(origin, origin + '/artifacts/another-private-file', 'GET', files).action,
    'reject',
  )
  assert.equal(
    fixtureRequest(origin, 'https://example.com/model.glb', 'GET', files).action,
    'reject',
  )
  assert.equal(
    fixtureRequest(origin, origin + '/api/v1/admin/products', 'POST', files).action,
    'reject',
  )
})

test('without explicit GPU release execution fails before reading files or launching Edge', async () => {
  await assert.rejects(runMaterialComparison({ allowGpu: false }), /GPU is owned/)
})

function browserRealm(t, vnode) {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document
  globalThis.document = { querySelector: () => ({ _vnode: vnode }) }
  globalThis.window = { __demo: { scene: { renderer: { instance: { backend: {} } } } } }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  })
}

test('finds the actual scene checkpoint through the parent template ref outside the DOM VNode tree', (t) => {
  const lighting = { snapshot: () => ({ frames: 3 }), setSignals() {} },
    actualPose = { slug: 'reventon', position: [1, 2, 3], target: [0.2, 0.4, 0.6] },
    sceneExposure = { realLighting: lighting, checkpoint: () => actualPose },
    vnode = {
      component: {
        type: { __name: 'WorkbenchStage' },
        exposed: { realLighting: lighting },
        refs: { sceneHost: sceneExposure },
        subTree: { children: [] },
      },
    }
  browserRealm(t, vnode)
  const diagnostics = attachFixtureRuntime(),
    actual = globalThis.window.__carMaterialFixture
  assert.equal(actual.lighting, lighting)
  assert.deepEqual(actual.captureCamera(), actualPose)
  assert.deepEqual(actual.initialCheckpoint, actualPose)
  assert.ok(
    diagnostics.some(
      (entry) => entry.origin === 'refs.sceneHost' && entry.checkpointType === 'function',
    ),
  )
  assert.ok(
    diagnostics.some((entry) => entry.origin === 'exposed' && entry.checkpointType === 'undefined'),
  )
})

test('unwraps scene template refs but never substitutes configured camera values for a missing reader', (t) => {
  const lighting = { snapshot() {}, setSignals() {} },
    vnode = {
      component: {
        type: { __name: 'WorkbenchStage' },
        exposed: { realLighting: lighting },
        refs: {},
      },
    }
  browserRealm(t, vnode)
  assert.throws(() => attachFixtureRuntime(), /Actual WorkbenchScene/)
  assert.ok(
    globalThis.window.__carMaterialBridgeDiagnostics.some(
      (entry) => entry.checkpointType === 'undefined',
    ),
  )
  vnode.component.refs.sceneHost = {
    value: {
      realLighting: { value: lighting },
      checkpoint: { value: () => ({ slug: 'reventon', position: [0, 1, 2], target: [0, 0, 0] }) },
    },
  }
  attachFixtureRuntime()
  assert.deepEqual(globalThis.window.__carMaterialFixture.captureCamera().target, [0, 0, 0])
})
