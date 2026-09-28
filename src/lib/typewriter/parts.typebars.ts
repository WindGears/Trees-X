import { PartBuilder } from './builder'
import { box, cached, lathe, merge, placed, sectorPlate, taperedBar } from './geometry'
import { BAR_REST_PITCH, BASKET, CHARS, barAngle, barPivot } from './dim'
import { at, type PartSpec } from './spec'

/**
 * 字杆组：44 字杆 + 带槽字杆篮 + 字杆垫杆 = 46 件。
 * 字杆共享一份几何：锥形杆臂 + 弯颈 + 字锤块。
 */

function typebarGeometry() {
  return cached('typebar', () => {
    const arm = placed(taperedBar(0.034, 0.02, 0.013, 0.42), [0, 0, 0.21])
    // 弯颈：两段短杆折角上扬
    const neck1 = placed(box(0.018, 0.014, 0.12), [0, 0.012, 0.455], [-0.35, 0, 0])
    const neck2 = placed(box(0.016, 0.013, 0.09), [0, 0.052, 0.52], [-0.95, 0, 0])
    // 字锤：面向打印点的小钢块
    const slug = placed(box(0.042, 0.05, 0.028), [0, 0.088, 0.545], [-0.35, 0, 0])
    return merge([arm, neck1, neck2, slug])
  })
}

export function buildTypebars(): { parts: PartSpec[]; barIds: string[] } {
  const b = new PartBuilder('typebars', 'TYP')
  const barIds: string[] = []

  for (let i = 0; i < BASKET.count; i++) {
    const char = CHARS[i]!
    const angle = barAngle(i)
    const pivot = barPivot(i)
    const yaw = -angle * 0.88
    const spreadX = Math.sin(angle) * 0.55
    const bar = b.add({
      name: `字杆 ${char}`,
      description: `铸钢字杆，字锤铸有「${char}」。静置时收拢于字杆篮，击发时绕枢轴摆向打印点；杆身弧度为演绎造型。`,
      material: 'steelSatin',
      make: typebarGeometry,
      assembled: at(pivot, [BAR_REST_PITCH, yaw, 0]),
      exploded: at(
        [pivot[0] + spreadX, pivot[1] + 0.5 + Math.abs(angle) * 0.22, pivot[2] + 0.34],
        [BAR_REST_PITCH + 0.15, yaw * 1.18, 0],
      ),
      flatSize: [0.06, 0.62],
      flatHeight: 0.035,
      flatYaw: angle * 0.32,
      stageOffset: Math.abs(angle) * 0.06,
      char,
    })
    barIds.push(bar.id)
  }

  b.add({
    name: '字杆篮',
    description:
      '带 44 条放射槽的扇形篮座，字杆枢轴沿弧缘排布。槽距与弧度按整机比例演绎，未见原厂图纸，属推测重建。',
    certainty: 'uncertain',
    material: 'cast',
    make: () =>
      merge([
        sectorPlate(0.72, 0.38, 2.24, 0.055),
        placed(box(0.1, 0.09, 0.16), [-0.62, 0.045, 0.42], [0, 0.5, 0]),
        placed(box(0.1, 0.09, 0.16), [0.62, 0.045, 0.42], [0, -0.5, 0]),
      ]),
    assembled: at([BASKET.cx, 0.42, BASKET.cz - 0.1], [0, 0, 0]),
    exploded: at([BASKET.cx, 0.18, BASKET.cz + 0.6], [0, 0, 0]),
    flatSize: [1.5, 0.9],
    flatHeight: 0.045,
  })

  b.add({
    name: '字杆垫杆',
    description: '横贯字杆扇前方的毡面垫杆，字杆静置时杆臂落在其上（演绎件）。',
    material: 'enamelFlat',
    make: () => lathe([[0.028, -0.5], [0.034, -0.46], [0.034, 0.46], [0.028, 0.5]], 16),
    assembled: at([0, 0.52, 0.52], [0, 0, Math.PI / 2]),
    exploded: at([0, 0.3, 0.95], [0, 0, Math.PI / 2]),
    flatSize: [1.05, 0.08],
    flatHeight: 0.034,
  })

  return { parts: b.parts, barIds }
}
