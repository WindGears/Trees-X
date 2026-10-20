import { describe, expect, it, vi } from 'vitest'
import { Texture } from 'three'
import { NodeMaterial } from 'three/webgpu'
import { texture, vec4 } from 'three/tsl'
import { classifySsrSources } from './ssrSourceClassification'

describe('SSR source-only classification bridge', () => {
  it('wraps only the effect instance material and restores the inherited builder', () => {
    const material = new NodeMaterial(),
      fragment = vec4(1),
      build = vi.fn(function (this: { _ssrMaterial: NodeMaterial }) {
        this._ssrMaterial.fragmentNode = fragment
      }),
      prototype = { _buildSSRMaterial: build },
      effect = Object.assign(Object.create(prototype), { _ssrMaterial: material }) as object,
      source = new Texture(),
      release = classifySsrSources(effect, texture(source))
    try {
      Reflect.get(effect, '_buildSSRMaterial').call(effect)
      expect(build).toHaveBeenCalledOnce()
      expect(material.fragmentNode).not.toBe(fragment)
      expect(prototype._buildSSRMaterial).toBe(build)
      expect(source.version).toBe(0)
      release()
      release()
      expect(Object.hasOwn(effect, '_buildSSRMaterial')).toBe(false)
      expect(Reflect.get(effect, '_buildSSRMaterial')).toBe(build)
      expect(material.fragmentNode).toBe(fragment)
    } finally {
      release()
      material.dispose()
      source.dispose()
    }
  })

  it('fails closed for an unaudited material shape', () => {
    const source = new Texture()
    try {
      expect(() => classifySsrSources({ _buildSSRMaterial() {} }, texture(source))).toThrow(
        'audited Three r185',
      )
    } finally {
      source.dispose()
    }
  })

  it('rejects double installation and readonly methods without changing the effect', () => {
    const material = new NodeMaterial(),
      source = new Texture(),
      effect = { _ssrMaterial: material, _buildSSRMaterial() {} },
      release = classifySsrSources(effect, texture(source))
    try {
      expect(() => classifySsrSources(effect, texture(source))).toThrow('already installed')
      release()
      const readonly = Object.freeze({ ...effect })
      expect(() => classifySsrSources(readonly, texture(source))).toThrow('writable data')
      expect(Object.hasOwn(readonly, '_buildSSRMaterial')).toBe(true)
    } finally {
      release()
      material.dispose()
      source.dispose()
    }
  })
})
