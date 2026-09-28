import { PartBuilder } from './builder'
import { box, cached, cyl, facePlate, lathe, merge, placed, ribbonStrip, roundedBox, tubeAlong } from './geometry'
import { CARRIAGE } from './dim'
import { at, type PartSpec } from './spec'

/**
 * 字车架组：35 件。滑架沿 X 布置，胶辊轴心见 CARRIAGE。
 * 回车扳手 = 握把 + 臂两件；压纸尺 = 杆 + 双滚轮 + 双臂。
 */

const { platenY, platenZ, platenRadius, platenLength, halfSpan } = CARRIAGE

function knobGeometry() {
  return cached('knob', () =>
    lathe(
      [
        [0.028, 0],
        [0.075, 0.01],
        [0.088, 0.05],
        [0.088, 0.1],
        [0.06, 0.13],
        [0.02, 0.13],
      ],
      24,
    ),
  )
}

export function buildCarriage(): { parts: PartSpec[]; carriageIds: string[] } {
  const b = new PartBuilder('carriage', 'CAR')

  b.add({
    name: '前滑轨',
    description: '字车架前部的圆柱滑轨，滚珠沿其滚动。表面抛光并保留纵向磨痕。',
    material: 'steel',
    make: () => cyl(0.035, 0.035, halfSpan * 2 + 0.06, 20),
    assembled: at([0, 1.06, -0.52], [0, 0, Math.PI / 2]),
    exploded: at([0, 0.62, -1.3], [0, 0, Math.PI / 2]),
    flatSize: [2.75, 0.09],
    flatHeight: 0.035,
  })
  b.add({
    name: '后滑轨',
    description: '字车架后部的 V 形导轨，与前滑轨共同约束滑架平移（演绎件）。',
    material: 'steelSatin',
    make: () =>
      merge([
        placed(box(2.74, 0.028, 0.07), [0, 0, 0]),
        placed(box(2.74, 0.028, 0.07), [0, 0.024, 0.024], [0.78, 0, 0]),
      ]),
    assembled: at([0, 1.02, -0.74]),
    exploded: at([0, 0.5, -1.62]),
    flatSize: [2.78, 0.12],
    flatHeight: 0.03,
  })
  b.add({
    name: '胶辊',
    description: '黑色橡胶压纸辊，纸张绕过它与送纸辊之间。辊面保留细微磨砂质感。',
    material: 'rubber',
    make: () => cyl(platenRadius, platenRadius, platenLength, 36),
    assembled: at([0, platenY, platenZ], [0, 0, Math.PI / 2]),
    exploded: at([0, 1.78, -1.1], [0, 0, Math.PI / 2]),
    flatSize: [platenLength, platenRadius * 2],
    flatHeight: platenRadius,
    flatYaw: 0.04,
  })
  b.add({
    name: '胶辊轴芯',
    description: '贯穿胶辊的钢轴，两端伸入端板轴承并固定旋钮。',
    material: 'steel',
    make: () => cyl(0.02, 0.02, platenLength + 0.3, 14),
    assembled: at([0, platenY, platenZ], [0, 0, Math.PI / 2]),
    exploded: at([0, 1.58, -1.42], [0, 0, Math.PI / 2]),
    flatSize: [platenLength + 0.3, 0.05],
    flatHeight: 0.02,
    flatYaw: -0.03,
  })
  b.add({
    name: '左胶辊旋钮',
    description: '胶辊左端的手动送纸旋钮，黑色酚醛质地（演绎件）。',
    material: 'enamelFlat',
    make: knobGeometry,
    assembled: at([-halfSpan - 0.04, platenY, platenZ], [0, 0, Math.PI / 2]),
    exploded: at([-2.0, 1.7, -1.1], [0, 0, Math.PI / 2]),
    flatSize: [0.19, 0.19],
    flatHeight: 0.09,
  })
  b.add({
    name: '右胶辊旋钮',
    description: '胶辊右端的手动送纸旋钮，与左旋钮成对（演绎件）。',
    material: 'enamelFlat',
    make: knobGeometry,
    assembled: at([halfSpan + 0.04, platenY, platenZ], [0, 0, -Math.PI / 2]),
    exploded: at([2.0, 1.7, -1.1], [0, 0, -Math.PI / 2]),
    flatSize: [0.19, 0.19],
    flatHeight: 0.09,
  })
  b.add({
    name: '压纸尺杆',
    description: '横贯胶辊前方的压纸杆，两只滚轮将纸张压向辊面。',
    material: 'steel',
    make: () => cyl(0.018, 0.018, 2.3, 14),
    assembled: at([0, platenY + 0.12, platenZ + 0.17], [0, 0, Math.PI / 2]),
    exploded: at([0, 2.06, -0.9], [0, 0, Math.PI / 2]),
    flatSize: [2.32, 0.05],
    flatHeight: 0.018,
  })
  b.add({
    name: '压纸尺左臂',
    description: '压纸杆左端的弯臂，铰接于滑架端板。',
    material: 'steelSatin',
    make: () => tubeAlong([[0, 0, 0], [-0.03, 0.16, 0.04], [-0.02, 0.3, 0.14]], 0.013),
    assembled: at([-1.06, 1.1, -0.6]),
    exploded: at([-1.5, 1.9, -1.05], [0, 0, 0.2]),
    flatSize: [0.1, 0.36],
    flatHeight: 0.014,
  })
  b.add({
    name: '压纸尺右臂',
    description: '压纸杆右端的弯臂，铰接于滑架端板。',
    material: 'steelSatin',
    make: () => tubeAlong([[0, 0, 0], [0.03, 0.16, 0.04], [0.02, 0.3, 0.14]], 0.013),
    assembled: at([1.06, 1.1, -0.6]),
    exploded: at([1.5, 1.9, -1.05], [0, 0, -0.2]),
    flatSize: [0.1, 0.36],
    flatHeight: 0.014,
  })
  b.add({
    name: '压纸左滚轮',
    description: '压纸杆下方的橡胶小滚轮（演绎件）。',
    material: 'rubber',
    make: () => cyl(0.034, 0.034, 0.14, 16),
    assembled: at([-0.55, platenY + 0.13, platenZ + 0.155], [0, 0, Math.PI / 2]),
    exploded: at([-0.8, 2.16, -0.85], [0, 0, Math.PI / 2]),
    flatSize: [0.15, 0.08],
    flatHeight: 0.034,
  })
  b.add({
    name: '压纸右滚轮',
    description: '压纸杆下方的橡胶小滚轮（演绎件）。',
    material: 'rubber',
    make: () => cyl(0.034, 0.034, 0.14, 16),
    assembled: at([0.55, platenY + 0.13, platenZ + 0.155], [0, 0, Math.PI / 2]),
    exploded: at([0.8, 2.16, -0.85], [0, 0, Math.PI / 2]),
    flatSize: [0.15, 0.08],
    flatHeight: 0.034,
  })
  b.add({
    name: '导纸板',
    description: '胶辊后上方的深色导纸板，纸张沿其竖起。板面微弧（演绎造型）。',
    material: 'enamel',
    make: () => facePlate(2.4, 0.66, 0.05, 0.028),
    assembled: at([0, 1.42, -1.02], [-0.52, 0, 0]),
    exploded: at([0, 2.2, -1.75], [-0.52, 0, 0]),
    flatSize: [2.42, 0.68],
    flatHeight: 0.015,
  })
  b.add({
    name: '标尺',
    description: '字车架前缘的纸面标尺，印刻 0–80 字位与 Kimi 小字（演绎装饰）。',
    material: 'paper',
    make: () => box(2.2, 0.045, 0.012),
    assembled: at([0, 1.17, -0.44], [-0.35, 0, 0]),
    exploded: at([0, 1.5, -0.6], [-0.35, 0, 0]),
    flatSize: [2.22, 0.06],
    flatHeight: 0.023,
  })
  b.add({
    name: '回车握把',
    description: '回车扳手前端的黑色握把，表面细密滚花（演绎件）。',
    material: 'enamelFlat',
    make: () => cyl(0.034, 0.034, 0.24, 16),
    assembled: at([-1.56, 1.28, -0.32], [1.2, 0, 0]),
    exploded: at([-2.1, 1.5, -0.5], [1.2, 0, 0.3]),
    flatSize: [0.09, 0.26],
    flatHeight: 0.034,
  })
  b.add({
    name: '回车臂',
    description: '从滑架左端伸出的弯臂，扳动它完成换行并送滑架回位。',
    material: 'steel',
    make: () => tubeAlong([[0, 0, 0], [-0.12, 0.06, 0.1], [-0.22, 0.14, 0.22], [-0.26, 0.2, 0.3]], 0.02),
    assembled: at([-1.3, 1.12, -0.6]),
    exploded: at([-1.85, 1.35, -0.85], [0, 0.2, 0]),
    flatSize: [0.34, 0.36],
    flatHeight: 0.03,
  })
  b.add({
    name: '左边距挡块',
    description: '后轨上可滑动的左边距挡块（演绎件）。',
    material: 'steelSatin',
    make: () => roundedBox(0.05, 0.07, 0.04, 0.008),
    assembled: at([-0.7, 1.08, -0.72]),
    exploded: at([-1.1, 0.68, -1.55]),
    flatSize: [0.06, 0.05],
    flatHeight: 0.035,
  })
  b.add({
    name: '右边距挡块',
    description: '后轨上可滑动的右边距挡块（演绎件）。',
    material: 'steelSatin',
    make: () => roundedBox(0.05, 0.07, 0.04, 0.008),
    assembled: at([0.7, 1.08, -0.72]),
    exploded: at([1.1, 0.68, -1.55]),
    flatSize: [0.06, 0.05],
    flatHeight: 0.035,
  })
  b.add({
    name: '左端板',
    description: '滑架左侧铸铁端板，承载滑轨与胶辊轴承。',
    material: 'cast',
    make: () => facePlate(0.5, 0.42, 0.05, 0.035),
    assembled: at([-1.31, 1.18, -0.62], [0, Math.PI / 2, 0]),
    exploded: at([-2.3, 1.2, -1.35], [0, Math.PI / 2, 0]),
    flatSize: [0.52, 0.44],
    flatHeight: 0.018,
  })
  b.add({
    name: '右端板',
    description: '滑架右侧铸铁端板，与左端板成对。',
    material: 'cast',
    make: () => facePlate(0.5, 0.42, 0.05, 0.035),
    assembled: at([1.31, 1.18, -0.62], [0, Math.PI / 2, 0]),
    exploded: at([2.3, 1.2, -1.35], [0, Math.PI / 2, 0]),
    flatSize: [0.52, 0.44],
    flatHeight: 0.018,
  })
  b.add({
    name: '左端盖',
    description: '滑架左端的黑色外罩（演绎件）。',
    material: 'enamel',
    make: () => roundedBox(0.1, 0.26, 0.46, 0.03),
    assembled: at([-1.4, 1.18, -0.62]),
    exploded: at([-2.55, 1.25, -0.9]),
    flatSize: [0.48, 0.28],
    flatHeight: 0.05,
  })
  b.add({
    name: '右端盖',
    description: '滑架右端的黑色外罩（演绎件）。',
    material: 'enamel',
    make: () => roundedBox(0.1, 0.26, 0.46, 0.03),
    assembled: at([1.4, 1.18, -0.62]),
    exploded: at([2.55, 1.25, -0.9]),
    flatSize: [0.48, 0.28],
    flatHeight: 0.05,
  })
  b.add({
    name: '牵纸带',
    description: '弹簧鼓通往滑架的织带，回车时拉动滑架左行（演绎件）。',
    material: 'ribbon',
    make: () => ribbonStrip([[0.92, 0.52, -0.18], [1.1, 0.8, -0.42], [1.24, 1.05, -0.58]], 0.03),
    assembled: at([0, 0, 0]),
    exploded: at([0.35, 0.35, -0.35]),
    flatSize: [0.06, 0.85],
    flatHeight: 0.006,
    flatYaw: 0.3,
  })
  const feedX = [-0.7, 0, 0.7]
  feedX.forEach((x, i) =>
    b.add({
      name: `送纸辊 ${i + 1}`,
      description: '胶辊下方前缘的送纸小辊，与胶辊对滚送纸（演绎件）。',
      material: 'rubber',
      make: () => cyl(0.03, 0.03, 0.2, 14),
      assembled: at([x, platenY - 0.12, platenZ + 0.1], [0, 0, Math.PI / 2]),
      exploded: at([x * 1.15, 1.32, -1.35], [0, 0, Math.PI / 2]),
      flatSize: [0.21, 0.07],
      flatHeight: 0.03,
    }),
  )
  b.add({
    name: '脱纸扳杆',
    description: '滑架右端的压纸释放扳杆（演绎件）。',
    material: 'steelSatin',
    make: () => merge([placed(box(0.02, 0.16, 0.014), [0, 0.08, 0]), placed(box(0.05, 0.024, 0.014), [0.014, 0.17, 0])]),
    assembled: at([1.27, 1.06, -0.5], [0, 0, -0.3]),
    exploded: at([1.7, 0.9, -1.0], [0, 0, -0.55]),
    flatSize: [0.07, 0.2],
    flatHeight: 0.009,
  })
  b.add({
    name: '换行拨杆',
    description: '左旋钮旁的换行间距拨杆（演绎件）。',
    material: 'steelSatin',
    make: () => merge([placed(box(0.018, 0.13, 0.012), [0, 0.065, 0]), placed(box(0.04, 0.02, 0.012), [0.01, 0.14, 0])]),
    assembled: at([-1.42, 1.32, -0.58], [0, 0, 0.5]),
    exploded: at([-1.9, 1.6, -0.75], [0, 0, 0.9]),
    flatSize: [0.06, 0.17],
    flatHeight: 0.009,
  })
  b.add({
    name: '换行棘轮',
    description: '胶辊轴左端的换行棘轮，与拨爪啮合控制行距（推测重建）。',
    certainty: 'uncertain',
    material: 'steel',
    make: () =>
      cached('ratchet', () => {
        const wheel = cyl(0.085, 0.085, 0.024, 24)
        const teeth = []
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2
          teeth.push(placed(box(0.014, 0.03, 0.012), [Math.cos(a) * 0.093, 0, Math.sin(a) * 0.093], [0, -a, 0]))
        }
        return merge([wheel, ...teeth])
      }),
    assembled: at([-1.28, platenY, platenZ]),
    exploded: at([-1.75, 1.75, -1.3]),
    flatSize: [0.2, 0.2],
    flatHeight: 0.013,
  })
  b.add({
    name: '左压纸指',
    description: '胶辊前上方的薄钢压纸指，防止纸张翘边（演绎件）。',
    material: 'steelSatin',
    make: () => placed(box(0.02, 0.01, 0.2), [0, 0, 0.06], [0.25, 0, 0]),
    assembled: at([-0.82, 1.32, -0.52]),
    exploded: at([-1.1, 1.85, -0.7]),
    flatSize: [0.04, 0.28],
    flatHeight: 0.006,
  })
  b.add({
    name: '右压纸指',
    description: '胶辊前上方的薄钢压纸指（演绎件）。',
    material: 'steelSatin',
    make: () => placed(box(0.02, 0.01, 0.2), [0, 0, 0.06], [0.25, 0, 0]),
    assembled: at([0.82, 1.32, -0.52]),
    exploded: at([1.1, 1.85, -0.7]),
    flatSize: [0.04, 0.28],
    flatHeight: 0.006,
  })
  b.add({
    name: '滑架锁扣',
    description: '前轨下方的滑架锁定扣（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => roundedBox(0.06, 0.05, 0.05, 0.01),
    assembled: at([0.9, 0.98, -0.55]),
    exploded: at([1.3, 0.6, -1.1]),
    flatSize: [0.07, 0.06],
    flatHeight: 0.025,
  })
  b.add({
    name: '星形轮',
    description: '与棘轮机构相邻的星形定位轮（推测重建）。',
    certainty: 'uncertain',
    material: 'steel',
    make: () => cyl(0.05, 0.05, 0.016, 8),
    assembled: at([0.32, 1.0, -0.56], [0, 0, Math.PI / 2]),
    exploded: at([0.6, 0.62, -1.2], [0, 0, Math.PI / 2]),
    flatSize: [0.11, 0.11],
    flatHeight: 0.009,
  })
  const rollerX = [-0.62, 0, 0.62]
  rollerX.forEach((x, i) =>
    b.add({
      name: `滑架滚轮 ${i + 1}`,
      description: '前轨与滑架之间的滚珠座轮（推测重建）。',
      certainty: 'uncertain',
      material: 'steel',
      make: () => cyl(0.026, 0.026, 0.02, 14),
      assembled: at([x, 1.0, -0.52]),
      exploded: at([x * 1.2, 0.56, -1.05]),
      flatSize: [0.06, 0.06],
      flatHeight: 0.013,
    }),
  )

  return { parts: b.parts, carriageIds: b.parts.map((p) => p.id) }
}
