import {
  CanvasTexture,
  DoubleSide,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three'
import type { MaterialKey } from './spec'

/**
 * 打字机材质工厂：战前便携机质感。
 * 全部由确定性程序纹理驱动；仅在浏览器端实例化（依赖 canvas）。
 * 所有权：createTypewriterMaterials 的调用方负责 dispose()。
 */

/** 确定性伪随机（材质纹理可复现） */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  return { canvas, ctx }
}

/** 黑红双色色带（UV.y 上半黑、下半红），带织物纹理 */
export function ribbonTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 64)
  ctx.fillStyle = '#181419'
  ctx.fillRect(0, 0, 512, 32)
  ctx.fillStyle = '#7c1f26'
  ctx.fillRect(0, 32, 512, 32)
  const rnd = mulberry32(77)
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * 64
    ctx.fillStyle = y < 32 ? `rgba(210,200,190,${rnd() * 0.05})` : `rgba(255,170,160,${rnd() * 0.05})`
    ctx.fillRect(rnd() * 512, y, 1 + rnd() * 2, 1)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, 31, 512, 2)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = RepeatWrapping
  return tex
}

/** 拉丝钢：粗糙度 + 凹凸共用的水平加工痕 */
export function brushedTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 256, 256)
  const rnd = mulberry32(1947)
  for (let i = 0; i < 900; i++) {
    const y = rnd() * 256
    const light = 96 + rnd() * 64
    ctx.strokeStyle = `rgba(${light},${light},${light},${0.16 + rnd() * 0.2})`
    ctx.lineWidth = 0.6 + rnd() * 0.8
    ctx.beginPath()
    ctx.moveTo(rnd() * 40 - 20, y)
    ctx.lineTo(256 - rnd() * 40 + 20, y + (rnd() - 0.5) * 3)
    ctx.stroke()
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

/** 铸铁皱纹漆凹凸 */
export function castTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 256, 256)
  const rnd = mulberry32(553)
  for (let i = 0; i < 5200; i++) {
    const v = 96 + rnd() * 64
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`
    const r = 0.5 + rnd() * 1.6
    ctx.beginPath()
    ctx.arc(rnd() * 256, rnd() * 256, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

/** 珐琅橘皮微起伏 */
export function enamelTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, 128, 128)
  const rnd = mulberry32(31)
  for (let i = 0; i < 900; i++) {
    const v = 110 + rnd() * 36
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`
    ctx.beginPath()
    ctx.arc(rnd() * 128, rnd() * 128, 0.8 + rnd() * 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

/** 字车架标尺：刻度 + Kimi 小字 */
export function scaleTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 64)
  ctx.fillStyle = '#ece4d0'
  ctx.fillRect(0, 0, 1024, 64)
  ctx.fillStyle = '#2b2820'
  ctx.textBaseline = 'top'
  for (let i = 0; i <= 80; i++) {
    const x = 24 + (i / 80) * 920
    const tall = i % 10 === 0
    ctx.fillRect(x, tall ? 8 : 18, tall ? 3 : 2, tall ? 30 : 18)
    if (tall && i > 0 && i < 80) {
      ctx.font = '600 22px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText(String(i), x, 40)
    }
  }
  ctx.font = 'italic 700 24px Georgia, serif'
  ctx.textAlign = 'right'
  ctx.fillText('Kimi', 1000, 12)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** 前脸 Kimi 徽标（金底深字） */
export function badgeTexture(): CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 192)
  const grad = ctx.createLinearGradient(0, 0, 512, 192)
  grad.addColorStop(0, '#caa55f')
  grad.addColorStop(0.5, '#e0c182')
  grad.addColorStop(1, '#b3904c')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 192)
  const rnd = mulberry32(9)
  ctx.globalAlpha = 0.08
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#fff' : '#5c4718'
    ctx.fillRect(rnd() * 512, rnd() * 192, 2 + rnd() * 8, 1)
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#6d551f'
  ctx.lineWidth = 6
  ctx.strokeRect(12, 12, 488, 168)
  ctx.fillStyle = '#2c2110'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'italic 700 96px Georgia, serif'
  ctx.fillText('Kimi', 256, 92)
  ctx.font = '600 26px Georgia, serif'
  ctx.fillText('P O R T A B L E', 256, 158)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export interface TypewriterMaterials {
  materials: Record<MaterialKey, MeshPhysicalMaterial>
  highlight: Record<MaterialKey, MeshPhysicalMaterial>
  dispose: () => void
}

export function createTypewriterMaterials(): TypewriterMaterials {
  const ribbon = ribbonTexture()
  const brushed = brushedTexture()
  const cast = castTexture()
  const enamelBump = enamelTexture()
  const scale = scaleTexture()
  const badge = badgeTexture()
  const textures = [ribbon, brushed, cast, enamelBump, scale, badge]

  const base = (params: ConstructorParameters<typeof MeshPhysicalMaterial>[0]) =>
    new MeshPhysicalMaterial(params)

  const materials: Record<MaterialKey, MeshPhysicalMaterial> = {
    enamel: base({
      color: '#1b1c20',
      roughness: 0.4,
      metalness: 0.08,
      clearcoat: 0.55,
      clearcoatRoughness: 0.3,
      bumpMap: enamelBump,
      bumpScale: 0.4,
      envMapIntensity: 0.9,
    }),
    enamelFlat: base({ color: '#17181b', roughness: 0.74, metalness: 0.05, envMapIntensity: 0.5 }),
    gold: base({
      color: '#c8a45e',
      metalness: 1,
      roughness: 0.27,
      clearcoat: 0.2,
      clearcoatRoughness: 0.4,
      envMapIntensity: 1.15,
    }),
    ivory: base({
      color: '#f1e9d5',
      roughness: 0.32,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.7,
    }),
    keyDark: base({
      color: '#26262b',
      roughness: 0.42,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.7,
    }),
    steel: base({
      color: '#dde2e6',
      metalness: 1,
      roughness: 0.16,
      roughnessMap: brushed,
      bumpMap: brushed,
      bumpScale: 0.15,
      envMapIntensity: 1.1,
    }),
    steelSatin: base({
      color: '#c6ccd3',
      metalness: 1,
      roughness: 0.34,
      roughnessMap: brushed,
      bumpMap: brushed,
      bumpScale: 0.1,
      envMapIntensity: 0.95,
    }),
    rubber: base({ color: '#191a1c', roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }),
    ribbon: base({
      color: '#ffffff',
      map: ribbon,
      roughness: 0.95,
      metalness: 0,
      side: DoubleSide,
      envMapIntensity: 0.3,
    }),
    cast: base({
      color: '#24262a',
      roughness: 0.68,
      metalness: 0.2,
      bumpMap: cast,
      bumpScale: 0.6,
      envMapIntensity: 0.55,
    }),
    paper: base({
      color: '#efe8d8',
      roughness: 0.85,
      metalness: 0,
      map: scale,
      envMapIntensity: 0.4,
    }),
    badge: base({
      color: '#ffffff',
      roughness: 0.4,
      metalness: 0.6,
      map: badge,
      envMapIntensity: 0.9,
    }),
  }

  const highlight = {} as Record<MaterialKey, MeshPhysicalMaterial>
  for (const key of Object.keys(materials) as MaterialKey[]) {
    const src = materials[key]
    const h = new MeshPhysicalMaterial()
    // 显式赋值而非 copy()：保留 clearcoat 等物理属性（copy 不复制物理扩展）
    h.color = src.color.clone()
    h.roughness = src.roughness
    h.metalness = src.metalness
    h.clearcoat = src.clearcoat
    h.clearcoatRoughness = src.clearcoatRoughness
    h.map = src.map
    h.bumpMap = src.bumpMap
    h.bumpScale = src.bumpScale
    h.roughnessMap = src.roughnessMap
    h.side = src.side
    h.envMapIntensity = src.envMapIntensity
    h.emissive.set('#b08d4f')
    h.emissiveIntensity = 0.42
    highlight[key] = h
  }
  const all: (Material | Texture)[] = [...textures, ...Object.values(materials), ...Object.values(highlight)]
  return {
    materials,
    highlight,
    dispose: () => {
      for (const item of all) item.dispose()
    },
  }
}
