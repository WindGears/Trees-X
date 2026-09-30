import { PartBuilder } from './builder'
import { box, cached, cyl, lathe, merge, placed, ribbonStrip, torus } from './geometry'
import { at, type PartSpec } from './spec'

/**
 * 色带组：16 件。左右带盘 + 卷绕色带 + 护盖 + 黑红色带本体 + 导带机构。
 * 色带路径：左盘 → 左导眼 → 升降导带叉（打印点下方）→ 右导眼 → 右盘。
 */

const SPOOL_Y = 1.02
const SPOOL_Z = -0.1
const SPOOL_X = 0.62

function spoolGeometry() {
  return cached('spool', () =>
    lathe(
      [
        [0.05, 0],
        [0.2, 0],
        [0.215, 0.012],
        [0.215, 0.02],
        [0.05, 0.02],
      ],
      36,
    ),
  )
}

function woundGeometry() {
  return cached('wound', () => {
    const ring = cyl(0.19, 0.19, 0.042, 36)
    // 挖出中心孔的视觉效果：叠加深色芯
    return ring
  })
}

function gearGeometry() {
  return cached('ribbonGear', () => {
    const wheel = cyl(0.075, 0.075, 0.02, 20)
    const teeth = []
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      teeth.push(
        placed(box(0.016, 0.024, 0.014), [Math.cos(a) * 0.082, 0, Math.sin(a) * 0.082], [0, -a, 0]),
      )
    }
    return merge([wheel, ...teeth])
  })
}

export function buildRibbon(): { parts: PartSpec[] } {
  const b = new PartBuilder('ribbon', 'RIB')

  for (const side of [-1, 1] as const) {
    const label = side < 0 ? '左' : '右'
    const x = side * SPOOL_X
    b.add({
      name: `${label}带盘`,
      description: `镀金色调的${label}侧色带盘，盘面冲压浅纹。色带自盘缘引出。`,
      material: 'gold',
      make: spoolGeometry,
      assembled: at([x, SPOOL_Y, SPOOL_Z]),
      exploded: at([x * 1.75, SPOOL_Y + 0.62, SPOOL_Z - 0.1]),
      flatSize: [0.44, 0.44],
      flatHeight: 0.02,
      flatYaw: side * 0.06,
    })
    b.add({
      name: `${label}盘卷带`,
      description: `缠绕在${label}带盘上的色带卷，黑红半幅并列（演绎件）。`,
      material: 'ribbon',
      make: woundGeometry,
      assembled: at([x, SPOOL_Y + 0.022, SPOOL_Z]),
      exploded: at([x * 1.75, SPOOL_Y + 0.7, SPOOL_Z - 0.1]),
      flatSize: [0.4, 0.4],
      flatHeight: 0.022,
    })
    b.add({
      name: `${label}带盘护盖`,
      description: `带盘上方的小护盖，防尘并引导色带走向（演绎件）。`,
      material: 'enamel',
      make: () =>
        lathe(
          [
            [0.03, 0],
            [0.13, 0.004],
            [0.16, 0.014],
            [0.16, 0.02],
            [0.03, 0.02],
          ],
          28,
        ),
      assembled: at([x, SPOOL_Y + 0.075, SPOOL_Z]),
      exploded: at([x * 1.75, SPOOL_Y + 0.82, SPOOL_Z - 0.1]),
      flatSize: [0.34, 0.34],
      flatHeight: 0.021,
    })
    b.add({
      name: `${label}带盘轴`,
      description: '带盘中心短轴，压入机架轴座（演绎件）。',
      material: 'steel',
      make: () => cyl(0.012, 0.012, 0.11, 10),
      assembled: at([x, SPOOL_Y - 0.03, SPOOL_Z]),
      exploded: at([x * 1.9, SPOOL_Y + 0.4, SPOOL_Z + 0.15]),
      flatSize: [0.03, 0.12],
      flatHeight: 0.007,
    })
    b.add({
      name: `${label}驱动齿轮`,
      description: `带盘下方的换向驱动齿轮，与棘爪交替啮合。`,
      certainty: 'uncertain',
      make: gearGeometry,
      material: 'steel',
      assembled: at([x, SPOOL_Y - 0.09, SPOOL_Z]),
      exploded: at([x * 2.05, SPOOL_Y + 0.18, SPOOL_Z + 0.3]),
      flatSize: [0.18, 0.18],
      flatHeight: 0.012,
    })
    b.add({
      name: `${label}导眼`,
      description: '色带进入打印区前的导线环（演绎件）。',
      material: 'steel',
      make: () => torus(0.022, 0.006),
      assembled: at([side * 0.32, 0.98, -0.32], [0.3, 0, 0]),
      exploded: at([side * 0.55, 1.35, -0.5], [0.3, 0, side * 0.4]),
      flatSize: [0.05, 0.05],
      flatHeight: 0.007,
    })
  }

  b.add({
    name: '色带',
    description:
      '黑红双色织物色带，上半黑、下半红，由换色杆选择打击半幅。路径依带盘与导带叉位置演绎。',
    material: 'ribbon',
    make: () =>
      ribbonStrip(
        [
          [-SPOOL_X + 0.06, SPOOL_Y + 0.03, SPOOL_Z - 0.12],
          [-0.45, 1.0, -0.26],
          [-0.32, 0.99, -0.33],
          [0, 1.0, -0.365],
          [0.32, 0.99, -0.33],
          [0.45, 1.0, -0.26],
          [SPOOL_X - 0.06, SPOOL_Y + 0.03, SPOOL_Z - 0.12],
        ],
        0.055,
      ),
    assembled: at([0, 0, 0]),
    exploded: at([0, 0.55, 0.28]),
    flatSize: [1.5, 0.35],
    flatHeight: 0.005,
  })
  b.add({
    name: '导带叉',
    description: '击发瞬间抬升色带至打印点的双齿叉架，平时藏于字锤下方（演绎件）。',
    material: 'steelSatin',
    make: () =>
      cached('vibrator', () =>
        merge([
          placed(box(0.1, 0.012, 0.03), [0, 0, 0]),
          placed(box(0.012, 0.05, 0.03), [-0.045, 0.02, 0]),
          placed(box(0.012, 0.05, 0.03), [0.045, 0.02, 0]),
          placed(box(0.016, 0.06, 0.014), [0, -0.03, 0.012]),
        ]),
      ),
    assembled: at([0, 0.97, -0.36]),
    exploded: at([0, 1.5, -0.15]),
    flatSize: [0.11, 0.09],
    flatHeight: 0.03,
  })
  b.add({
    name: '换向叉',
    description: '带盘之间的换向拨叉，色带尽端时切换收带方向（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () =>
      merge([
        placed(box(0.014, 0.1, 0.012), [0, 0.05, 0]),
        placed(box(0.05, 0.014, 0.012), [0.018, 0.1, 0]),
      ]),
    assembled: at([-0.3, 0.88, -0.06], [0, 0, 0.2]),
    exploded: at([-0.5, 0.6, 0.35], [0, 0, 0.5]),
    flatSize: [0.06, 0.12],
    flatHeight: 0.007,
  })
  b.add({
    name: '换向棘爪',
    description: '与驱动齿轮交替啮合的小棘爪（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => placed(box(0.016, 0.07, 0.012), [0, 0.035, 0], [0, 0, 0.3]),
    assembled: at([0.3, 0.9, -0.06]),
    exploded: at([0.52, 0.62, 0.35], [0, 0, 0.6]),
    flatSize: [0.04, 0.09],
    flatHeight: 0.007,
  })

  return { parts: b.parts }
}
