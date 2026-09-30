import { PartBuilder } from './builder'
import { box, cached, cyl, lathe, merge, placed, torus, tubeAlong } from './geometry'
import { barPivot, keyLayout } from './dim'
import { at, type PartSpec } from './spec'

/**
 * 五金组：222 件。
 * 44 字杆枢轴销 + 44 字杆弹簧 + 50 键弹簧 + 28 垫圈
 * + 14 壳体螺钉 + 12 机架螺钉 + 10 滑架螺钉 + 4 带盘螺钉
 * + 6 卡箍 + 6 支架 + 4 脚垫 = 222。
 */

/** 螺旋弹簧（N 圈螺旋管） */
function springGeometry(turns: number, radius: number, height: number, wire: number) {
  return cached(`spring:${turns},${radius},${height},${wire}`, () => {
    const pts: [number, number, number][] = []
    const n = turns * 10
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const a = t * turns * Math.PI * 2
      pts.push([Math.cos(a) * radius, t * height, Math.sin(a) * radius])
    }
    return tubeAlong(pts, wire)
  })
}

function screwGeometry() {
  return cached('screw', () =>
    merge([
      placed(cyl(0.016, 0.016, 0.01, 12), [0, 0.018, 0]),
      placed(cyl(0.007, 0.007, 0.026, 8), [0, 0, 0]),
    ]),
  )
}

function washerGeometry() {
  return cached('washer', () => torus(0.02, 0.007))
}

function bracketGeometry() {
  return cached('bracket', () =>
    merge([
      placed(box(0.06, 0.012, 0.04), [0, 0, 0]),
      placed(box(0.012, 0.05, 0.04), [-0.024, 0.025, 0]),
    ]),
  )
}

function clipGeometry() {
  return cached('clip', () => torus(0.018, 0.005, Math.PI * 1.5))
}

function footGeometry() {
  return cached('foot', () =>
    lathe(
      [
        [0.055, 0],
        [0.06, 0.012],
        [0.045, 0.04],
        [0.02, 0.045],
      ],
      20,
    ),
  )
}

export function buildHardware(): { parts: PartSpec[] } {
  const b = new PartBuilder('hardware', 'HDW')

  // 44 字杆枢轴销
  for (let i = 0; i < 44; i++) {
    const p = barPivot(i)
    b.add({
      name: `字杆枢轴销 ${i + 1}`,
      description: '字杆根部穿过篮弧的枢轴销（推测重建）。',
      certainty: 'uncertain',
      material: 'steel',
      make: () => cyl(0.008, 0.008, 0.07, 8),
      assembled: at([p[0], p[1] - 0.02, p[2]], [0, 0, Math.PI / 2]),
      exploded: at([p[0] * 1.3, 0.14, p[2] + 0.7], [0, 0, Math.PI / 2]),
      flatSize: [0.08, 0.02],
      flatHeight: 0.008,
    })
  }
  // 44 字杆回位弹簧
  for (let i = 0; i < 44; i++) {
    const p = barPivot(i)
    b.add({
      name: `字杆弹簧 ${i + 1}`,
      description: '字杆根部的螺旋回位弹簧（推测重建）。',
      certainty: 'uncertain',
      material: 'steelSatin',
      make: () => springGeometry(4, 0.018, 0.07, 0.004),
      assembled: at([p[0] * 0.96, 0.4, p[2] + 0.06]),
      exploded: at([p[0] * 1.2, 0.05, p[2] + 0.55]),
      flatSize: [0.045, 0.045],
      flatHeight: 0.036,
    })
  }
  // 50 键帽回位弹簧
  const keys = keyLayout()
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    b.add({
      name: `键弹簧 ${i + 1}`,
      description: '键帽下方的锥形回位弹簧（推测重建）。',
      certainty: 'uncertain',
      material: 'steelSatin',
      make: () => springGeometry(3, 0.03, 0.06, 0.005),
      assembled: at([k.x * 0.96, 0.36, k.z - 0.04]),
      exploded: at([k.x * 1.05, 0.12, k.z + 0.35]),
      flatSize: [0.065, 0.065],
      flatHeight: 0.032,
    })
  }
  // 28 垫圈：12 滑架 + 16 机架
  const washerSpots: [number, number, number][] = []
  for (let i = 0; i < 12; i++) washerSpots.push([-1.25 + i * 0.23, 0.985, -0.52])
  for (let i = 0; i < 16; i++) washerSpots.push([-1.3 + (i % 8) * 0.37, 0.19, i < 8 ? 1.1 : -1.1])
  washerSpots.forEach((p, i) =>
    b.add({
      name: `垫圈 ${i + 1}`,
      description: '螺栓接合处的平垫圈（演绎件）。',
      material: 'steel',
      make: washerGeometry,
      assembled: at([p[0], p[1], p[2]]),
      exploded: at([p[0] * 1.15, p[1] - 0.35, p[2] * 1.2]),
      flatSize: [0.05, 0.05],
      flatHeight: 0.007,
    }),
  )
  // 14 壳体螺钉（底壳周圈）
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const x = Math.cos(a) * 1.45
    const z = Math.sin(a) * 1.35
    b.add({
      name: `壳体螺钉 ${i + 1}`,
      description: '固定底壳的沉头螺钉（演绎件）。',
      material: 'steel',
      make: screwGeometry,
      assembled: at([x, 0.02, z]),
      exploded: at([x * 1.2, -0.45, z * 1.2]),
      flatSize: [0.04, 0.04],
      flatHeight: 0.014,
    })
  }
  // 12 机架螺钉
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const j = Math.floor(i / 2)
    b.add({
      name: `机架螺钉 ${i + 1}`,
      description: '固定机架侧板与横梁的螺钉（演绎件）。',
      material: 'steel',
      make: screwGeometry,
      assembled: at(
        [side * 1.38, 0.42 + (j % 3) * 0.08, -0.9 + Math.floor(j / 3) * 0.9],
        [0, 0, side * (Math.PI / 2)],
      ),
      exploded: at(
        [side * 1.9, 0.25, -0.9 + Math.floor(j / 3) * 0.9],
        [0, 0, side * (Math.PI / 2)],
      ),
      flatSize: [0.04, 0.04],
      flatHeight: 0.014,
    })
  }
  // 10 滑架螺钉
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const j = Math.floor(i / 2)
    b.add({
      name: `滑架螺钉 ${i + 1}`,
      description: '滑架端板与端盖的固定螺钉（演绎件）。',
      material: 'steel',
      make: screwGeometry,
      assembled: at([side * 1.44, 1.02 + (j % 5) * 0.07, -0.62], [0, 0, side * (Math.PI / 2)]),
      exploded: at([side * 2.75, 0.95 + (j % 5) * 0.07, -0.85], [0, 0, side * (Math.PI / 2)]),
      flatSize: [0.04, 0.04],
      flatHeight: 0.014,
    })
  }
  // 4 带盘螺钉
  for (const [i, x] of [-0.62, 0.62, -0.62, 0.62].entries()) {
    const z = i < 2 ? -0.1 : 0.02
    b.add({
      name: `带盘螺钉 ${i + 1}`,
      description: '带盘轴座的固定螺钉（演绎件）。',
      material: 'gold',
      make: screwGeometry,
      assembled: at([x, 1.0, z]),
      exploded: at([x * 1.8, 0.85, z + 0.3]),
      flatSize: [0.04, 0.04],
      flatHeight: 0.014,
    })
  }
  // 6 卡箍（万向杆/滑轨定位）
  const clipSpots: [number, number, number][] = [
    [-0.8, 0.38, 0.3],
    [0.8, 0.38, 0.3],
    [-1.0, 1.06, -0.52],
    [1.0, 1.06, -0.52],
    [-0.5, 1.06, -0.52],
    [0.5, 1.06, -0.52],
  ]
  clipSpots.forEach((p, i) =>
    b.add({
      name: `定位卡箍 ${i + 1}`,
      description: '轴向定位的开口卡箍（演绎件）。',
      material: 'steelSatin',
      make: clipGeometry,
      assembled: at(p, [0, Math.PI / 2, 0]),
      exploded: at([p[0] * 1.2, p[1] - 0.42, p[2] - 0.3], [0, Math.PI / 2, 0]),
      flatSize: [0.045, 0.045],
      flatHeight: 0.006,
    }),
  )
  // 6 角支架
  const bracketSpots: [number, number, number][] = [
    [-1.3, 0.2, 1.15],
    [1.3, 0.2, 1.15],
    [-1.3, 0.2, -1.15],
    [1.3, 0.2, -1.15],
    [-1.3, 0.6, -1.0],
    [1.3, 0.6, -1.0],
  ]
  bracketSpots.forEach((p, i) =>
    b.add({
      name: `角支架 ${i + 1}`,
      description: '壳体与机架之间的 L 形连接支架（演绎件）。',
      material: 'steelSatin',
      make: bracketGeometry,
      assembled: at(p),
      exploded: at([p[0] * 1.35, p[1] - 0.3, p[2] * 1.25]),
      flatSize: [0.07, 0.05],
      flatHeight: 0.026,
    }),
  )
  // 4 脚垫
  const feet: [number, number][] = [
    [-1.35, 1.3],
    [1.35, 1.3],
    [-1.35, -1.3],
    [1.35, -1.3],
  ]
  feet.forEach(([x, z], i) =>
    b.add({
      name: `橡胶脚垫 ${i + 1}`,
      description: '底壳四角的橡胶防滑脚垫（演绎件）。',
      material: 'rubber',
      make: footGeometry,
      assembled: at([x, -0.02, z]),
      exploded: at([x * 1.25, -0.5, z * 1.2]),
      flatSize: [0.13, 0.13],
      flatHeight: 0.045,
    }),
  )

  return { parts: b.parts }
}
