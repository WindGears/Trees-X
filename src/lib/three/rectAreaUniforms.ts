import { Texture, UniformsLib } from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

const names = ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2']
let users = 0
let textures: Texture[] = []

/** All mounted area-light studios share one library; the last studio releases it. */
export function acquireRectAreaUniforms() {
  if (users === 0) {
    RectAreaLightUniformsLib.init()
    const library = UniformsLib as unknown as Record<string, unknown>
    textures = names.map((name) => {
      const value = library[name]
      if (!(value instanceof Texture)) throw new Error('面光源纹理库未正确初始化')
      return value
    })
  }
  users++
  let released = false
  return () => {
    if (released) return
    released = true
    users--
    if (users !== 0) return
    textures.forEach((texture) => texture.dispose())
    textures = []
  }
}
