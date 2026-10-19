import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { WebGPURenderer, type RenderTarget } from 'three/webgpu'
import { createContactShadow } from '../src/lib/reventon/contactShadow'
import { createGpuReventonShadow } from '../src/lib/workbench/rendering/reventonShadow'

type FixtureResult = {
  backend: string
  verticalBlurTarget: { x: number; z: number; mass: number }
  horizontalBlurTarget: { x: number; z: number; mass: number }
  presentation: { x: number; z: number; mass: number }
  passes: number
}
declare global {
  interface Window {
    carShadowFixture?: FixtureResult
    carShadowFixtureError?: string
  }
}

const size = 768,
  gpu = new URLSearchParams(location.search).get('backend') === 'webgpu',
  renderer = gpu ? new WebGPURenderer({ antialias: true }) : new WebGLRenderer({ antialias: true }),
  scene = new Scene(),
  model = new Group(),
  targets: (RenderTarget | WebGLRenderTarget)[] = [],
  captures: { x: number; z: number; mass: number }[] = [],
  camera = new OrthographicCamera(-6, 6, 6, -6, 0.1, 20)
renderer.setPixelRatio(1)
renderer.setSize(size, size)
renderer.toneMapping = NoToneMapping
scene.background = new Color('white')
camera.position.set(0, 8, 0)
camera.up.set(0, 0, 1)
camera.lookAt(0, 0, 0)
const casterGeometry = new BoxGeometry(1.4, 0.5, 2),
  casterMaterial = new MeshBasicMaterial({ color: '#ff0000' }),
  caster = new Mesh(casterGeometry, casterMaterial)
caster.position.set(1.15, 0.26, 2.2)
model.add(caster)
scene.add(model)
document.body.append(renderer.domElement)

function centroid(
  pixels: Uint8Array,
  width: number,
  height: number,
  alpha: boolean,
  topOrigin: boolean,
) {
  let x = 0,
    z = 0,
    mass = 0
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const offset = (row * width + col) * 4,
        weight = alpha ? pixels[offset + 3]! : 255 - pixels[offset]!
      mass += weight
      x += ((col + 0.5) / width - 0.5) * 12 * weight
      z += ((row + 0.5) / height - 0.5) * 12 * (topOrigin ? -1 : 1) * weight
    }
  return { x: x / mass, z: z / mass, mass }
}

async function run() {
  if (renderer instanceof WebGPURenderer) {
    await renderer.init()
    if (Reflect.get(renderer.backend, 'isWebGPUBackend') !== true)
      throw new Error('Native WebGPU required; fallback cannot validate RT coordinates')
  }
  const setTarget = renderer.setRenderTarget.bind(renderer)
  renderer.setRenderTarget = (target, ...rest) => {
    if (target && !targets.includes(target)) targets.push(target)
    return setTarget(target, ...rest)
  }
  const shadow =
    renderer instanceof WebGPURenderer
      ? createGpuReventonShadow(renderer, scene, model)
      : createContactShadow(renderer, scene, model)
  shadow.render()
  renderer.setRenderTarget = setTarget
  for (const target of targets) {
    const pixels =
      renderer instanceof WebGPURenderer
        ? new Uint8Array(
            await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height),
          )
        : (() => {
            const bytes = new Uint8Array(target.width * target.height * 4)
            renderer.readRenderTargetPixels(
              target as WebGLRenderTarget,
              0,
              0,
              target.width,
              target.height,
              bytes,
            )
            return bytes
          })()
    captures.push(centroid(pixels, target.width, target.height, true, gpu))
  }
  // Capture the final receiver independently of caster shading or SSGI.
  model.visible = false
  const outputTarget =
    renderer instanceof WebGPURenderer
      ? new (await import('three/webgpu')).RenderTarget(size, size)
      : new (await import('three')).WebGLRenderTarget(size, size)
  renderer.setRenderTarget(outputTarget)
  renderer.render(scene, camera)
  const presentation =
    renderer instanceof WebGPURenderer
      ? new Uint8Array(await renderer.readRenderTargetPixelsAsync(outputTarget, 0, 0, size, size))
      : (() => {
          const pixels = new Uint8Array(size * size * 4)
          renderer.readRenderTargetPixels(
            outputTarget as WebGLRenderTarget,
            0,
            0,
            size,
            size,
            pixels,
          )
          return pixels
        })()
  renderer.setRenderTarget(null)
  renderer.render(scene, camera)
  const presented = centroid(presentation, size, size, false, gpu)
  window.carShadowFixture = {
    backend: gpu ? 'webgpu' : 'webgl2',
    verticalBlurTarget: captures[0]!,
    horizontalBlurTarget: captures[1]!,
    presentation: {
      ...presented,
      // Looking down -Y with +Z up makes the camera's right axis -X.
      x: -presented.x,
    },
    passes: 3,
  }
  // Retain only the small final canvas until the browser captures it.
  outputTarget.dispose()
  shadow.dispose()
  casterGeometry.dispose()
  casterMaterial.dispose()
}
void run().catch((error: unknown) => {
  window.carShadowFixtureError = error instanceof Error ? error.stack : String(error)
})
