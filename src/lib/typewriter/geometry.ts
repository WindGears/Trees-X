import {
  BoxGeometry,
  CylinderGeometry,
  LatheGeometry,
  Shape,
  ExtrudeGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  TorusGeometry,
  Vector2,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * 共享几何构建器。所有构建经 cache() 去重：
 * 572 个零件网格只持有约几十份几何实例。
 */

const cache = new Map<string, BufferGeometry>()

export function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  const hit = cache.get(key)
  if (hit) return hit
  const geo = make()
  cache.set(key, geo)
  return geo
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): BufferGeometry {
  return cached(`rb:${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r))
}

export function box(w: number, h: number, d: number): BufferGeometry {
  return cached(`bx:${w},${h},${d}`, () => new BoxGeometry(w, h, d))
}

export function cyl(rt: number, rb: number, h: number, seg = 24): BufferGeometry {
  return cached(`cy:${rt},${rb},${h},${seg}`, () => new CylinderGeometry(rt, rb, h, seg))
}

export function torus(r: number, t: number, arc = Math.PI * 2): BufferGeometry {
  return cached(`to:${r},${t},${arc}`, () => new TorusGeometry(r, t, 12, 32, arc))
}

/** 沿线段的锥形方杆（z+ 端收窄），用于字杆臂、扳杆 */
export function taperedBar(w0: number, w1: number, h: number, len: number): BufferGeometry {
  return cached(`tb:${w0},${w1},${h},${len}`, () => {
    const geo = new BoxGeometry(w0, h, len, 1, 1, 4)
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const k = (z / len + 0.5) * (w1 / w0 - 1) + 1
      pos.setX(i, pos.getX(i) * k)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  })
}

/** 三维折线/曲线圆管 */
export function tubeAlong(points: [number, number, number][], radius: number): BufferGeometry {
  const key = `tu:${radius}:${points.map((p) => p.map((v) => v.toFixed(3)).join(',')).join('|')}`
  return cached(key, () => {
    const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)))
    return new TubeGeometry(curve, Math.max(8, points.length * 6), radius, 8, false)
  })
}

/** 二维轮廓绕 Y 轴旋转（旋钮、脚垫、带盘） */
export function lathe(profile: [number, number][], seg = 28): BufferGeometry {
  const key = `la:${seg}:${profile.map((p) => p.map((v) => v.toFixed(3)).join(',')).join('|')}`
  return cached(key, () => new LatheGeometry(profile.map((p) => new Vector2(...p)), seg))
}

/** 带圆角的矩形薄板（沿 Z 挤出，面向 ±Z） */
export function facePlate(w: number, h: number, r: number, thickness: number): BufferGeometry {
  return cached(`fp:${w},${h},${r},${thickness}`, () => {
    const s = new Shape()
    const x = -w / 2
    const y = -h / 2
    s.moveTo(x + r, y)
    s.lineTo(x + w - r, y)
    s.quadraticCurveTo(x + w, y, x + w, y + r)
    s.lineTo(x + w, y + h - r)
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    s.lineTo(x + r, y + h)
    s.quadraticCurveTo(x, y + h, x, y + h - r)
    s.lineTo(x, y + r)
    s.quadraticCurveTo(x, y, x + r, y)
    const geo = new ExtrudeGeometry(s, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: Math.min(0.012, thickness * 0.2),
      bevelSize: Math.min(0.012, r * 0.5),
      bevelSegments: 2,
      curveSegments: 5,
    })
    geo.translate(0, 0, -thickness / 2)
    return geo
  })
}

/** 圆环扇形板（字杆篮座），up=挤出方向 +Y */
export function sectorPlate(
  rOuter: number,
  rInner: number,
  angle: number,
  height: number,
): BufferGeometry {
  return cached(`sp:${rOuter},${rInner},${angle},${height}`, () => {
    const s = new Shape()
    const a0 = -angle / 2
    s.absarc(0, 0, rOuter, a0, a0 + angle, false)
    s.absarc(0, 0, rInner, a0 + angle, a0, true)
    s.closePath()
    const geo = new ExtrudeGeometry(s, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 24,
    })
    geo.rotateX(Math.PI / 2)
    geo.translate(0, height, 0)
    return geo
  })
}

/** 合并同材质子几何为一个零件（统一转非索引，避免索引/属性不一致） */
export function merge(geos: BufferGeometry[]): BufferGeometry {
  const normalized = geos.map((g) => {
    let out: BufferGeometry = g.index ? g.toNonIndexed() : g
    // 仅保留 position/normal/uv，去掉自定义属性
    const keep = ['position', 'normal', 'uv']
    for (const name of Object.keys(out.attributes)) {
      if (!keep.includes(name)) out.deleteAttribute(name)
    }
    if (!out.getAttribute('normal')) out.computeVertexNormals()
    if (!out.getAttribute('uv')) {
      const count = out.getAttribute('position')!.count
      out.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2))
    }
    return out
  })
  const merged = mergeGeometries(normalized, false)
  if (!merged) throw new Error('mergeGeometries failed')
  return merged
}

/** 平移/旋转辅助：返回作用后的新几何（不写入缓存，调用方自行缓存） */
export function placed(
  geo: BufferGeometry,
  p: [number, number, number],
  r: [number, number, number] = [0, 0, 0],
): BufferGeometry {
  const g = geo.clone()
  if (r[0]) g.rotateX(r[0])
  if (r[1]) g.rotateY(r[1])
  if (r[2]) g.rotateZ(r[2])
  g.translate(...p)
  return g
}

/**
 * 沿折线的扁平色带（宽 w，UV.y 横跨带宽以取黑/红半区）。
 * 截面始终水平，适合色带从带盘到导带叉的走线。
 */
export function ribbonStrip(points: [number, number, number][], w: number): BufferGeometry {
  const up = new Vector3(0, 1, 0)
  const positions: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  const pts = points.map((p) => new Vector3(...p))
  const curve = new CatmullRomCurve3(pts)
  const n = 64
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const c = curve.getPoint(t)
    const tan = curve.getTangent(t)
    const side = new Vector3().crossVectors(tan, up)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize().multiplyScalar(w / 2)
    positions.push(c.x - side.x, c.y - side.y, c.z - side.z)
    positions.push(c.x + side.x, c.y + side.y, c.z + side.z)
    uvs.push(t, 0, t, 1)
    if (i < n) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

/** 重映射圆柱顶面 UV 到图集格子（键帽字符） */
export function remapCapTopUV(
  geo: BufferGeometry,
  col: number,
  row: number,
  cols: number,
  rows: number,
): void {
  const group = geo.groups.find((g) => g.materialIndex === 1)
  const uv = geo.getAttribute('uv') as Float32BufferAttribute
  if (!group || !uv) return
  for (let i = group.start; i < group.start + group.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    uv.setXY(i, (col + u) / cols, 1 - (row + 1 - v) / rows)
  }
  uv.needsUpdate = true
}

/** 清空缓存（测试用） */
export function clearGeometryCache() {
  cache.clear()
}

export function geometryCacheSize() {
  return cache.size
}
