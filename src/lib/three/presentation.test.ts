import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { demoProduct } from '@/data/products'
import { disposeModel, normalizeModel } from './model'
import { createModelPresentation } from './presentation'

const bytes = await readFile(new URL('../../../public/models/form-01.glb', import.meta.url))
async function load() {
  const root = (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')).scene
  normalizeModel(root)
  return root
}

describe('real FORM / 01 presentation', () => {
  it('isolates the finish from shared metal and disposes clone and original once each', async () => {
    const root = await load()
    const chassis = root.getObjectByName('Chassis') as Mesh
    const frame = root.getObjectByName('Woofer_Frame') as Mesh
    expect(chassis.material).toBe(frame.material)
    const original = chassis.material as MeshStandardMaterial
    const color = original.color.clone()
    const originalDispose = vi.spyOn(original, 'dispose')
    const view = createModelPresentation(root, demoProduct)
    const clone = chassis.material as MeshStandardMaterial
    const cloneDispose = vi.spyOn(clone, 'dispose')
    view.setFinish(demoProduct.finishes[1]!)
    expect(clone.color.equals(color)).toBe(false)
    expect((frame.material as MeshStandardMaterial).color.equals(color)).toBe(true)
    view.dispose()
    view.dispose()
    expect(chassis.material).toBe(original)
    expect(cloneDispose).toHaveBeenCalledOnce()
    expect(originalDispose).not.toHaveBeenCalled()
    disposeModel(root)
    expect(originalDispose).toHaveBeenCalledOnce()
  })

  it('maps every authored part and resets expansion without drift or changing geometry', async () => {
    const root = await load()
    for (const group of demoProduct.structure) {
      for (const name of group.nodes) expect(root.getObjectByName(name), name).toBeDefined()
    }
    for (const part of demoProduct.hotspots) expect(root.getObjectByName(part.node)).toBeDefined()
    const node = root.getObjectByName('Woofer_Frame') as Mesh
    const origin = node.position.clone()
    const geometry = node.geometry
    const view = createModelPresentation(root, demoProduct)
    for (let i = 0; i < 20; i++) {
      view.setExpansion(1)
      expect(node.position.distanceTo(origin)).toBeGreaterThan(0.9)
      view.setExpansion(0)
      expect(node.position.equals(origin)).toBe(true)
    }
    view.setExpansion(0.5)
    expect(
      node.position.distanceTo(origin.clone().add(new Vector3(-0.14, -0.04, 0.475))),
    ).toBeLessThan(1e-8)
    expect(node.geometry).toBe(geometry)
    view.dispose()
    expect(node.position.equals(origin)).toBe(true)
    disposeModel(root)
  })
})
