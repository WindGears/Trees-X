import { PartBuilder } from './builder'
import { box, cached, cyl, facePlate, merge, placed, roundedBox } from './geometry'
import { at, type PartSpec } from './spec'

/**
 * 机架组：30 件。铸铁主架、侧板、横梁、棘轮组件、弹簧鼓与支撑。
 * 内部不可见件统一标注为推测重建。
 */

function chassisGeometry() {
  return cached('chassis', () => {
    const base = placed(roundedBox(2.9, 0.1, 2.55, 0.04), [0, 0, 0])
    const wallF = placed(box(2.9, 0.16, 0.08), [0, 0.1, 1.24])
    const wallB = placed(box(2.9, 0.16, 0.08), [0, 0.1, -1.24])
    const wallL = placed(box(0.08, 0.16, 2.4), [-1.41, 0.1, 0])
    const wallR = placed(box(0.08, 0.16, 2.4), [1.41, 0.1, 0])
    return merge([base, wallF, wallB, wallL, wallR])
  })
}

export function buildFrame(): { parts: PartSpec[] } {
  const b = new PartBuilder('frame', 'FRM')

  b.add({
    name: '主机架',
    description: '铸铁主机架，承载全部机构的骨架。表面皱纹黑漆为演绎质感。',
    material: 'cast',
    make: chassisGeometry,
    assembled: at([0, 0.14, 0]),
    exploded: at([0, -0.55, 0]),
    flatSize: [2.95, 2.6],
    flatHeight: 0.09,
  })
  b.add({
    name: '左机侧板',
    description: '机架左侧的铸铁加强板（演绎件）。',
    material: 'cast',
    make: () => facePlate(2.3, 0.42, 0.05, 0.04),
    assembled: at([-1.36, 0.42, 0.1], [0, Math.PI / 2, 0]),
    exploded: at([-2.05, 0.3, 0.1], [0, Math.PI / 2, 0]),
    flatSize: [2.32, 0.44],
    flatHeight: 0.021,
  })
  b.add({
    name: '右机侧板',
    description: '机架右侧的铸铁加强板（演绎件）。',
    material: 'cast',
    make: () => facePlate(2.3, 0.42, 0.05, 0.04),
    assembled: at([1.36, 0.42, 0.1], [0, Math.PI / 2, 0]),
    exploded: at([2.05, 0.3, 0.1], [0, Math.PI / 2, 0]),
    flatSize: [2.32, 0.44],
    flatHeight: 0.021,
  })
  b.add({
    name: '前横梁',
    description: '键盘区下方的钢制横梁（演绎件）。',
    material: 'steelSatin',
    make: () => box(2.5, 0.06, 0.08),
    assembled: at([0, 0.32, 1.02]),
    exploded: at([0, 0.05, 1.45]),
    flatSize: [2.52, 0.1],
    flatHeight: 0.03,
  })
  b.add({
    name: '后横梁',
    description: '字杆篮后方的钢制横梁（演绎件）。',
    material: 'steelSatin',
    make: () => box(2.5, 0.06, 0.08),
    assembled: at([0, 0.32, -0.32]),
    exploded: at([0, 0.02, -0.75]),
    flatSize: [2.52, 0.1],
    flatHeight: 0.03,
  })
  b.add({
    name: '换行棘轮',
    description: '控制滑架步进的棘轮。齿距与啮合关系为推测重建。',
    certainty: 'uncertain',
    material: 'steel',
    make: () =>
      cached('escapement', () => {
        const wheel = cyl(0.11, 0.11, 0.022, 24)
        const teeth = []
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2
          teeth.push(
            placed(box(0.012, 0.026, 0.01), [Math.cos(a) * 0.118, 0, Math.sin(a) * 0.118], [0, -a, 0]),
          )
        }
        return merge([wheel, ...teeth])
      }),
    assembled: at([0.15, 0.6, -0.28]),
    exploded: at([0.15, 0.32, -0.9]),
    flatSize: [0.25, 0.25],
    flatHeight: 0.012,
  })
  b.add({
    name: '棘轮小齿轮',
    description: '与换行棘轮同轴的小齿轮（推测重建）。',
    certainty: 'uncertain',
    material: 'steel',
    make: () => cyl(0.04, 0.04, 0.07, 12),
    assembled: at([0.15, 0.53, -0.28]),
    exploded: at([0.45, 0.28, -0.85]),
    flatSize: [0.09, 0.09],
    flatHeight: 0.035,
  })
  b.add({
    name: '棘轮齿条',
    description: '连接滑架的步进齿条（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => box(0.5, 0.018, 0.05),
    assembled: at([-0.2, 0.58, -0.28]),
    exploded: at([-0.35, 0.26, -0.8]),
    flatSize: [0.52, 0.06],
    flatHeight: 0.01,
  })
  b.add({
    name: '弹簧鼓',
    description: '储存回位动力的卷簧鼓，牵纸带由此引出（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => cyl(0.15, 0.15, 0.1, 28),
    assembled: at([0.92, 0.46, -0.16]),
    exploded: at([1.35, 0.2, -0.4]),
    flatSize: [0.31, 0.31],
    flatHeight: 0.05,
  })
  b.add({
    name: '弹簧鼓盖',
    description: '弹簧鼓顶部的金色调压盖（演绎件）。',
    material: 'gold',
    make: () => cyl(0.16, 0.16, 0.02, 28),
    assembled: at([0.92, 0.52, -0.16]),
    exploded: at([1.5, 0.34, -0.5]),
    flatSize: [0.33, 0.33],
    flatHeight: 0.011,
  })
  b.add({
    name: '牵带锚柱',
    description: '牵纸带在弹簧鼓侧的固定锚柱（推测重建）。',
    certainty: 'uncertain',
    material: 'steel',
    make: () => cyl(0.012, 0.012, 0.09, 10),
    assembled: at([1.12, 0.5, -0.2]),
    exploded: at([1.55, 0.22, -0.3]),
    flatSize: [0.03, 0.1],
    flatHeight: 0.007,
  })
  b.add({
    name: '边距齿条',
    description: '机身后部上方的边距挡块滑轨（演绎件）。',
    material: 'steelSatin',
    make: () => box(1.8, 0.03, 0.06),
    assembled: at([0, 0.95, -0.82]),
    exploded: at([0, 0.7, -1.25]),
    flatSize: [1.82, 0.08],
    flatHeight: 0.016,
  })
  b.add({
    name: '制表齿条',
    description: '制表停止位的齿条（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => box(1.6, 0.03, 0.05),
    assembled: at([0, 0.52, -0.44]),
    exploded: at([0, 0.24, -0.85]),
    flatSize: [1.62, 0.07],
    flatHeight: 0.016,
  })
  b.add({
    name: '换档滑轨',
    description: '换档时升降键盘/字杆区段的滑轨（演绎件）。',
    material: 'steelSatin',
    make: () => box(2.0, 0.04, 0.04),
    assembled: at([0, 0.3, 0.55]),
    exploded: at([0, 0.02, 0.9]),
    flatSize: [2.02, 0.06],
    flatHeight: 0.02,
  })
  b.add({
    name: '万向杆左支座',
    description: '万向杆左端的铰接支座（演绎件）。',
    material: 'cast',
    make: () => merge([placed(box(0.05, 0.12, 0.05), [0, 0.06, 0]), placed(box(0.09, 0.03, 0.07), [0, 0.015, 0])]),
    assembled: at([-1.0, 0.32, 0.3]),
    exploded: at([-1.35, 0.08, 0.55]),
    flatSize: [0.1, 0.08],
    flatHeight: 0.06,
  })
  b.add({
    name: '万向杆右支座',
    description: '万向杆右端的铰接支座（演绎件）。',
    material: 'cast',
    make: () => merge([placed(box(0.05, 0.12, 0.05), [0, 0.06, 0]), placed(box(0.09, 0.03, 0.07), [0, 0.015, 0])]),
    assembled: at([1.0, 0.32, 0.3]),
    exploded: at([1.35, 0.08, 0.55]),
    flatSize: [0.1, 0.08],
    flatHeight: 0.06,
  })
  b.add({
    name: '左色带驱动座',
    description: '左带盘下方的驱动机构支座（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => merge([placed(box(0.1, 0.14, 0.1), [0, 0.07, 0]), placed(box(0.14, 0.03, 0.14), [0, 0.015, 0])]),
    assembled: at([-0.62, 0.85, -0.1]),
    exploded: at([-1.05, 0.5, 0.25]),
    flatSize: [0.15, 0.15],
    flatHeight: 0.07,
  })
  b.add({
    name: '右色带驱动座',
    description: '右带盘下方的驱动机构支座（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => merge([placed(box(0.1, 0.14, 0.1), [0, 0.07, 0]), placed(box(0.14, 0.03, 0.14), [0, 0.015, 0])]),
    assembled: at([0.62, 0.85, -0.1]),
    exploded: at([1.05, 0.5, 0.25]),
    flatSize: [0.15, 0.15],
    flatHeight: 0.07,
  })
  b.add({
    name: '键杆后导梳',
    description: '键杆尾部穿过的导向梳板，保持杆距（演绎件）。',
    material: 'steelSatin',
    make: () =>
      cached('rearComb', () => {
        const plate = placed(box(1.9, 0.02, 0.07), [0, 0, 0])
        const fins = []
        for (let i = 0; i < 24; i++) fins.push(placed(box(0.006, 0.05, 0.05), [-0.9 + i * 0.078, 0.03, 0]))
        return merge([plate, ...fins])
      }),
    assembled: at([0, 0.46, 0.24]),
    exploded: at([0, 0.1, 0.55]),
    flatSize: [1.92, 0.1],
    flatHeight: 0.026,
  })
  b.add({
    name: '后导板',
    description: '字杆区后部的导向板（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => box(1.8, 0.02, 0.28),
    assembled: at([0, 0.44, -0.08]),
    exploded: at([0, 0.14, -0.5]),
    flatSize: [1.82, 0.3],
    flatHeight: 0.011,
  })
  b.add({
    name: '前系杆',
    description: '机架前部的加固系杆（演绎件）。',
    material: 'steelSatin',
    make: () => box(2.6, 0.05, 0.06),
    assembled: at([0, 0.26, 0.72]),
    exploded: at([0, -0.02, 1.1]),
    flatSize: [2.62, 0.08],
    flatHeight: 0.025,
  })
  b.add({
    name: '后系杆',
    description: '机架后部的加固系杆（演绎件）。',
    material: 'steelSatin',
    make: () => box(2.6, 0.05, 0.06),
    assembled: at([0, 0.26, -0.55]),
    exploded: at([0, -0.05, -0.95]),
    flatSize: [2.62, 0.08],
    flatHeight: 0.025,
  })
  b.add({
    name: '定位掣板',
    description: '棘轮旁的定位掣子安装板（推测重建）。',
    certainty: 'uncertain',
    material: 'steelSatin',
    make: () => merge([placed(box(0.12, 0.02, 0.08), [0, 0, 0]), placed(box(0.02, 0.07, 0.02), [0.05, 0.04, 0])]),
    assembled: at([0.34, 0.62, -0.26]),
    exploded: at([0.62, 0.3, -0.75]),
    flatSize: [0.13, 0.09],
    flatHeight: 0.035,
  })
  b.add({
    name: '换行拨爪座',
    description: '换行拨爪的安装座（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => merge([placed(box(0.08, 0.1, 0.08), [0, 0.05, 0]), placed(box(0.12, 0.02, 0.12), [0, 0.01, 0])]),
    assembled: at([-0.5, 0.56, -0.28]),
    exploded: at([-0.8, 0.24, -0.72]),
    flatSize: [0.13, 0.13],
    flatHeight: 0.05,
  })
  b.add({
    name: '左滑架支柱',
    description: '支撑字车架滑轨的左立柱（演绎件）。',
    material: 'cast',
    make: () => merge([placed(box(0.09, 0.5, 0.09), [0, 0.25, 0]), placed(box(0.16, 0.04, 0.16), [0, 0.02, 0])]),
    assembled: at([-1.18, 0.62, -0.6]),
    exploded: at([-1.7, 0.4, -1.0]),
    flatSize: [0.17, 0.17],
    flatHeight: 0.25,
  })
  b.add({
    name: '右滑架支柱',
    description: '支撑字车架滑轨的右立柱（演绎件）。',
    material: 'cast',
    make: () => merge([placed(box(0.09, 0.5, 0.09), [0, 0.25, 0]), placed(box(0.16, 0.04, 0.16), [0, 0.02, 0])]),
    assembled: at([1.18, 0.62, -0.6]),
    exploded: at([1.7, 0.4, -1.0]),
    flatSize: [0.17, 0.17],
    flatHeight: 0.25,
  })
  b.add({
    name: '送纸长轴',
    description: '横贯机身后部的送纸传动长轴（推测重建）。',
    certainty: 'uncertain',
    material: 'steel',
    make: () => cyl(0.015, 0.015, 2.2, 12),
    assembled: at([0, 0.68, -0.48], [0, 0, Math.PI / 2]),
    exploded: at([0, 0.36, -0.9], [0, 0, Math.PI / 2]),
    flatSize: [2.22, 0.04],
    flatHeight: 0.015,
  })
  b.add({
    name: '底部密封垫',
    description: '主机架与底壳之间的橡胶密封垫（演绎件）。',
    material: 'rubber',
    make: () => roundedBox(2.86, 0.02, 2.51, 0.02),
    assembled: at([0, 0.08, 0]),
    exploded: at([0, -0.3, 0]),
    flatSize: [2.9, 2.55],
    flatHeight: 0.01,
  })
  b.add({
    name: '左字杆篮支柱',
    description: '字杆篮左支撑（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => merge([placed(box(0.07, 0.3, 0.07), [0, 0.15, 0]), placed(box(0.12, 0.03, 0.12), [0, 0.015, 0])]),
    assembled: at([-0.48, 0.28, 0.12]),
    exploded: at([-0.85, 0.05, 0.3]),
    flatSize: [0.13, 0.13],
    flatHeight: 0.15,
  })
  b.add({
    name: '右字杆篮支柱',
    description: '字杆篮右支撑（推测重建）。',
    certainty: 'uncertain',
    material: 'cast',
    make: () => merge([placed(box(0.07, 0.3, 0.07), [0, 0.15, 0]), placed(box(0.12, 0.03, 0.12), [0, 0.015, 0])]),
    assembled: at([0.48, 0.28, 0.12]),
    exploded: at([0.85, 0.05, 0.3]),
    flatSize: [0.13, 0.13],
    flatHeight: 0.15,
  })

  return { parts: b.parts }
}
