import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { Mesh, MeshPhysicalMaterial } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createSpeakerMaterials } from './speakerMaterials'
import { createModelPresentation } from './presentation'
import { disposeModel } from './model'
import { demoProduct } from '@/data/products'

it('keeps authored UVs and nested dial detail; releases shared surface texture once after the finish clone', async () => {
  const bytes = await readFile(new URL('../../../public/models/form-01.glb', import.meta.url))
  const root = (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '')).scene
  const chassis = root.getObjectByName('Chassis') as Mesh
  const dial = root.getObjectByName('Volume_Dial')!
  expect(dial.children.some((child) => child.name === 'Dial_Knurl_0')).toBe(true)
  expect(chassis.geometry.getAttribute('uv').count).toBe(
    chassis.geometry.getAttribute('position').count,
  )
  const original = chassis.material
  const originalDispose = vi.spyOn(Array.isArray(original) ? original[0]! : original, 'dispose')
  const release = createSpeakerMaterials(root)
  const enhanced = chassis.material as MeshPhysicalMaterial
  const materialDispose = vi.spyOn(enhanced, 'dispose')
  const textureDispose = vi.spyOn(enhanced.roughnessMap!, 'dispose')
  expect(enhanced.anisotropy).toBe(0.65)
  const view = createModelPresentation(root, demoProduct)
  view.setFinish(demoProduct.finishes[1]!)
  expect((chassis.material as MeshPhysicalMaterial).roughnessMap).toBe(enhanced.roughnessMap)
  view.setExpansion(1)
  expect(root.getObjectByName('Dial_Knurl_0')!.parent).toBe(dial)
  view.dispose()
  expect(chassis.material).toBe(enhanced)
  release()
  release()
  expect(chassis.material).toBe(original)
  expect(materialDispose).toHaveBeenCalledOnce()
  expect(textureDispose).toHaveBeenCalledOnce()
  expect(originalDispose).not.toHaveBeenCalled()
  disposeModel(root)
  expect(originalDispose).toHaveBeenCalledOnce()
})
