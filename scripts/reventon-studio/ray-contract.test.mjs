import assert from 'node:assert/strict'
import test from 'node:test'
import { rayContractCases, verifyRayContract } from './ray-contract.mjs'

test('independent ray expectations retain native IBL on misses and signed black hits', () => {
  const native = new Float32Array([2, 3, 4, 0.5, 0, 0, 0, 0]),
    cases = [
      [-0.875, -1.25, -1.5, 0, 0, 0, 0, 0],
      [-1, -1.5, -2, 0, 0, 0, 0, 0],
      [-1.375, -2.6875, -3.375, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ]
  rayContractCases.forEach((item, index) => {
    const result = verifyRayContract(native, new Float32Array(cases[index]), item.rays)
    assert.equal(result.supportedPixels, 1)
    assert.equal(result.maximumError, 0)
  })
})

test('rejects mean-RGBA misclassification, loss of negative correction and empty support', () => {
  const native = new Float32Array([2, 3, 4, 1]),
    zero = new Float32Array(4)
  assert.throws(() => verifyRayContract(native, zero, rayContractCases[0].rays), /mismatch/)
  assert.throws(() => verifyRayContract(native, zero, rayContractCases[1].rays), /mismatch/)
  assert.throws(() => verifyRayContract(zero, zero, rayContractCases[3].rays), /no SSR-supported/)
  assert.throws(
    () => verifyRayContract(native, new Float32Array([NaN, 0, 0, 0]), rayContractCases[3].rays),
    /finite/,
  )
})
