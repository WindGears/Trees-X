import { REVISION } from 'three'
import { Node, NodeMaterial, type TextureNode } from 'three/webgpu'
import { Fn, uv } from 'three/tsl'

const installed = new WeakSet<object>()

/** r185 instance-local seam: skip unsupported ray origins, never their depth
 * or beauty at other rays' hit points. No global SSR prototype is patched.
 * The effect still owns its material; this owner only restores its method.
 */
export function classifySsrSources(effect: object, nativeSingle: TextureNode) {
  if (installed.has(effect)) throw new Error('SSR source classification is already installed')
  const key = '_buildSSRMaterial',
    build: unknown = Reflect.get(effect, key),
    material: unknown = Reflect.get(effect, '_ssrMaterial')
  if (REVISION !== '185' || typeof build !== 'function' || !(material instanceof NodeMaterial))
    throw new Error('SSR source classification requires the audited Three r185 material seam')
  const own = Object.getOwnPropertyDescriptor(effect, key)
  if (own && (!('value' in own) || !own.writable))
    throw new Error('SSR material builder must be a writable data method')
  let originalFragment: Node | undefined, classifiedFragment: Node | undefined
  const classifiedBuild = () => {
    build.call(effect)
    const fragment = material.fragmentNode
    if (fragment === null) return // setup has not captured the SSR function yet.
    if (!(fragment instanceof Node)) throw new Error('SSR fragment shape changed')
    originalFragment = fragment
    classifiedFragment = Fn(() => {
      nativeSingle.sample(uv()).a.lessThanEqual(0).discard()
      return fragment
    })()
    material.fragmentNode = classifiedFragment
    material.needsUpdate = true
  }
  if (!Reflect.set(effect, key, classifiedBuild))
    throw new Error('SSR material builder cannot be classified')
  installed.add(effect)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    installed.delete(effect)
    if (material.fragmentNode === classifiedFragment && originalFragment) {
      material.fragmentNode = originalFragment
      material.needsUpdate = true
    }
    if (Reflect.get(effect, key) !== classifiedBuild) return
    if (own) Object.defineProperty(effect, key, own)
    else Reflect.deleteProperty(effect, key)
  }
}
