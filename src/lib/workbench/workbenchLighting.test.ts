import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AmbientLight, DirectionalLight, Mesh, Scene } from 'three'
import { dispose as disposeTres } from '@tresjs/core'
import { createWorkbenchLighting } from './workbenchLighting'
import { defaultStage } from './presentationV2'
import { afterPreparation, withPreparationLease } from './rendering/preparationLease'

describe('explicit workbench lighting ownership', () => {
  it('preserves authored lights, 2048 shadow settings, ground and trace support', () => {
    const owner = createWorkbenchLighting(defaultStage, false)
    const [ambient, key, rim] = owner.root.children
    const ground = owner.root.getObjectByName('workbench-ground')
    expect(ambient).toBeInstanceOf(AmbientLight)
    expect(key).toBeInstanceOf(DirectionalLight)
    expect(rim).toBeInstanceOf(DirectionalLight)
    if (!(key instanceof DirectionalLight) || !(ground instanceof Mesh)) throw new Error('lighting')
    expect(key.shadow.mapSize.toArray()).toEqual([2048, 2048])
    expect([key.shadow.normalBias, key.shadow.bias, key.shadow.radius]).toEqual([
      0.005, -0.00008, 3,
    ])
    expect(key.intensity).toBe(defaultStage.key.intensity)
    expect(ground.rotation.x).toBe(-Math.PI / 2)
    expect(ground.position.y).toBe(defaultStage.groundY)
    expect(ground.userData.traceSupport).toBe(true)
    owner.update(defaultStage, true)
    expect(key.castShadow).toBe(false)
    expect(owner.root.getObjectByName('workbench-ground')).toBeUndefined()
    owner.update(defaultStage, false)
    expect(owner.root.getObjectByName('workbench-ground')).toBe(ground)
    const geometry = vi.spyOn(ground.geometry, 'dispose')
    owner.dispose()
    owner.dispose()
    expect(geometry).toHaveBeenCalledOnce()
  })
  it('detaches before the real Tres recursive scene disposer and releases only after compile settles', async () => {
    const renderer = {},
      scene = new Scene(),
      owner = createWorkbenchLighting(defaultStage, false)
    scene.add(owner.root)
    const ground = owner.root.getObjectByName('workbench-ground')
    if (!(ground instanceof Mesh) || Array.isArray(ground.material)) throw new Error('ground')
    const geometry = vi.spyOn(ground.geometry, 'dispose')
    const material = vi.spyOn(ground.material, 'dispose')
    let finish!: () => void
    const compile = withPreparationLease(
      renderer,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    owner.root.removeFromParent()
    afterPreparation(renderer, owner.dispose)
    disposeTres(scene)
    expect(geometry).not.toHaveBeenCalled()
    expect(material).not.toHaveBeenCalled()
    finish()
    await compile
    expect(geometry).toHaveBeenCalledOnce()
    expect(material).toHaveBeenCalledOnce()
  })
  it('checks the installed Tres primitive ownership contract used by the component', () => {
    const source = readFileSync('node_modules/@tresjs/core/dist/tres.js', 'utf8')
    expect(source).toContain('const isPrimitive = node.__tres?.primitive;')
    expect(source).toContain('dispose === "default" ? !isPrimitive : !!dispose')
    expect(source).toContain('if (userDispose === null) dispose = false;')
  })
})
