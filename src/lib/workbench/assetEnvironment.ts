import { EquirectangularReflectionMapping, PMREMGenerator, WebGLRenderer } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

export function createAssetEnvironment(file: string, data: ArrayBuffer, renderer: WebGLRenderer) {
  const loader = file.endsWith('.exr') ? new EXRLoader() : new HDRLoader()
  const texture = loader.createDataTexture(data)
  texture.mapping = EquirectangularReflectionMapping
  const generator = new PMREMGenerator(renderer)
  try {
    return generator.fromEquirectangular(texture)
  } finally {
    texture.dispose()
    generator.dispose()
  }
}
