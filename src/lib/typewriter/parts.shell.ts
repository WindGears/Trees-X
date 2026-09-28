import { PartBuilder } from './builder'
import { box, cached, cyl, facePlate, merge, placed, roundedBox, tubeAlong } from './geometry'
import { at, type PartSpec } from './spec'

/**
 * 外壳组：19 件。缎面黑珐琅壳体，卷边与金色调镍饰条。
 * 壳面使用带圆角的挤型板，呈现「轻微成型」的曲面感。
 */

function hoodGeometry() {
  return cached('hood', () => {
    const dome = placed(roundedBox(2.86, 0.42, 1.5, 0.1, 4), [0, 0, 0])
    // 前缘下卷
    const lip = placed(roundedBox(2.7, 0.16, 0.2, 0.06), [0, -0.2, 0.78], [0.25, 0, 0])
    return merge([dome, lip])
  })
}

export function buildShell(): { parts: PartSpec[] } {
  const b = new PartBuilder('shell', 'SHL')

  b.add({
    name: '底壳',
    description: '承托整机的缎面黑底壳，四角卷边收圆。内侧不可见，表面质感为演绎。',
    material: 'enamelFlat',
    make: () => roundedBox(3.2, 0.1, 3.0, 0.045, 4),
    assembled: at([0, 0.05, 0]),
    exploded: at([0, -0.62, 0.35]),
    flatSize: [3.22, 3.02],
    flatHeight: 0.05,
  })
  b.add({
    name: '主壳罩',
    description:
      '覆盖字杆区的主壳罩，缎面黑珐琅带轻微清漆光泽，前缘下卷。曲面为造型演绎，非原厂钣金数据。',
    material: 'enamel',
    make: hoodGeometry,
    assembled: at([0, 0.86, -0.12], [-0.045, 0, 0]),
    exploded: at([0, 1.85, -0.5], [-0.045, 0, 0]),
    flatSize: [2.9, 1.55],
    flatHeight: 0.22,
  })
  b.add({
    name: '色带盖',
    description: '顶部后方的色带检修盖，缎面黑珐琅，后缘带铰链（演绎件）。',
    material: 'enamel',
    make: () => roundedBox(1.66, 0.055, 0.86, 0.024),
    assembled: at([0, 1.12, -0.22], [-0.1, 0, 0]),
    exploded: at([0, 2.35, -0.6], [-0.1, 0, 0]),
    flatSize: [1.68, 0.88],
    flatHeight: 0.028,
  })
  b.add({
    name: '左侧壳',
    description: '机身左侧的缎面外壳板，边缘向内卷边（演绎件）。',
    material: 'enamel',
    make: () => roundedBox(0.1, 0.72, 2.6, 0.045),
    assembled: at([-1.53, 0.52, 0.05]),
    exploded: at([-2.3, 0.62, 0.05]),
    flatSize: [2.62, 0.74],
    flatHeight: 0.05,
  })
  b.add({
    name: '右侧壳',
    description: '机身右侧的缎面外壳板，与左侧壳成对（演绎件）。',
    material: 'enamel',
    make: () => roundedBox(0.1, 0.72, 2.6, 0.045),
    assembled: at([1.53, 0.52, 0.05]),
    exploded: at([2.3, 0.62, 0.05]),
    flatSize: [2.62, 0.74],
    flatHeight: 0.05,
  })
  b.add({
    name: '前脸板',
    description: '键盘前方的斜面饰板，下缘卷起。Kimi 徽标贴附其上（演绎件）。',
    material: 'enamel',
    make: () => facePlate(3.0, 0.52, 0.07, 0.045),
    assembled: at([0, 0.3, 1.52], [-0.4, 0, 0]),
    exploded: at([0, 0.2, 2.25], [-0.4, 0, 0]),
    flatSize: [3.02, 0.55],
    flatHeight: 0.024,
  })
  b.add({
    name: '后围板',
    description: '机身后部的缎面围板，遮住滑架后方（演绎件）。',
    material: 'enamel',
    make: () => facePlate(3.0, 0.62, 0.06, 0.04),
    assembled: at([0, 0.5, -1.26], [0.14, 0, 0]),
    exploded: at([0, 0.35, -2.0], [0.14, 0, 0]),
    flatSize: [3.02, 0.65],
    flatHeight: 0.022,
  })
  b.add({
    name: 'Kimi 徽标',
    description: '前脸中央的金底铭牌，斜体 Kimi 字标与 PORTABLE 小字（品牌装饰演绎件）。',
    material: 'badge',
    make: () => facePlate(0.62, 0.24, 0.03, 0.018),
    assembled: at([0, 0.34, 1.6], [-0.4, 0, 0]),
    exploded: at([0, 0.5, 2.35], [-0.4, 0, 0]),
    flatSize: [0.64, 0.26],
    flatHeight: 0.012,
  })
  b.add({
    name: '左壳罩饰条',
    description: '主壳罩左缘的金色调饰条，压入壳面凹槽（演绎件）。',
    material: 'gold',
    make: () => placed(box(0.024, 0.012, 1.42), [0, 0, 0]),
    assembled: at([-1.38, 1.06, -0.12], [-0.045, 0, 0]),
    exploded: at([-1.75, 1.9, -0.3], [-0.045, 0, 0]),
    flatSize: [1.44, 0.04],
    flatHeight: 0.007,
  })
  b.add({
    name: '右壳罩饰条',
    description: '主壳罩右缘的金色调饰条（演绎件）。',
    material: 'gold',
    make: () => placed(box(0.024, 0.012, 1.42), [0, 0, 0]),
    assembled: at([1.38, 1.06, -0.12], [-0.045, 0, 0]),
    exploded: at([1.75, 1.9, -0.3], [-0.045, 0, 0]),
    flatSize: [1.44, 0.04],
    flatHeight: 0.007,
  })
  b.add({
    name: '前脸饰条',
    description: '前脸下缘的金色调长饰条（演绎件）。',
    material: 'gold',
    make: () => placed(box(2.86, 0.014, 0.02), [0, 0, 0]),
    assembled: at([0, 0.1, 1.72], [-0.4, 0, 0]),
    exploded: at([0, 0.02, 2.4], [-0.4, 0, 0]),
    flatSize: [2.88, 0.04],
    flatHeight: 0.008,
  })
  b.add({
    name: '左铰链节',
    description: '色带盖左侧的铰链节，金色调（演绎件）。',
    material: 'gold',
    make: () => cyl(0.028, 0.028, 0.14, 14),
    assembled: at([-0.6, 1.14, -0.62], [0, 0, Math.PI / 2]),
    exploded: at([-0.95, 2.2, -0.95], [0, 0, Math.PI / 2]),
    flatSize: [0.15, 0.06],
    flatHeight: 0.028,
  })
  b.add({
    name: '右铰链节',
    description: '色带盖右侧的铰链节，金色调（演绎件）。',
    material: 'gold',
    make: () => cyl(0.028, 0.028, 0.14, 14),
    assembled: at([0.6, 1.14, -0.62], [0, 0, Math.PI / 2]),
    exploded: at([0.95, 2.2, -0.95], [0, 0, Math.PI / 2]),
    flatSize: [0.15, 0.06],
    flatHeight: 0.028,
  })
  const corners: [string, number, number][] = [
    ['左前包角', -1.5, 1.4],
    ['右前包角', 1.5, 1.4],
    ['左后包角', -1.5, -1.36],
    ['右后包角', 1.5, -1.36],
  ]
  for (const [name, x, z] of corners)
    b.add({
      name,
      description: '底壳四角的防护包角，金色调镍件（演绎件）。',
      material: 'gold',
      make: () => roundedBox(0.16, 0.14, 0.16, 0.05),
      assembled: at([x, 0.1, z]),
      exploded: at([x * 1.35, -0.35, z * 1.3]),
      flatSize: [0.18, 0.18],
      flatHeight: 0.07,
    })
  b.add({
    name: '色带台板',
    description: '带盘下方的缎面台板，开孔供驱动轴穿过（演绎件）。',
    material: 'enamel',
    make: () => facePlate(1.8, 0.9, 0.05, 0.03),
    assembled: at([0, 0.99, -0.1], [-Math.PI / 2 + 0.02, 0, 0]),
    exploded: at([0, 1.5, 0.35], [-Math.PI / 2 + 0.02, 0, 0]),
    flatSize: [1.82, 0.92],
    flatHeight: 0.016,
  })
  b.add({
    name: '提手',
    description: '后部的携行提手，钢管弯成、黑漆饰面（演绎件）。',
    material: 'enamelFlat',
    make: () =>
      tubeAlong(
        [
          [-0.5, 0, 0],
          [-0.5, 0.16, -0.02],
          [0, 0.22, -0.04],
          [0.5, 0.16, -0.02],
          [0.5, 0, 0],
        ],
        0.022,
      ),
    assembled: at([0, 0.72, -1.32], [0.2, 0, 0]),
    exploded: at([0, 1.05, -2.1], [0.2, 0, 0]),
    flatSize: [1.06, 0.28],
    flatHeight: 0.022,
  })
  return { parts: b.parts }
}
