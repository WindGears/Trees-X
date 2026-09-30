import type { BufferGeometry } from 'three'
import { PartBuilder } from './builder'
import { box, cached, cyl, lathe, merge, placed, taperedBar, tubeAlong } from './geometry'
import { keyLayout, barPivot, CHARS } from './dim'
import { at, type PartSpec, type Transform } from './spec'

/**
 * 连杆组：50 键杆 + 44 拉线 + 万向杆 + 空格联动 + 功能扳杆 = 104 件。
 * 键杆共享按行缓存的几何；拉线按起止点长度分桶缓存。
 */

/** 拉线长度分桶（0.02 精度），让相近长度共享几何 */
function pullLink(len: number) {
  const bucket = Math.round(len / 0.02) * 0.02
  return cached(`pull:${bucket.toFixed(2)}`, () => {
    const rod = cyl(0.006, 0.006, bucket, 8)
    const hook = placed(box(0.02, 0.012, 0.02), [0, bucket / 2, 0])
    const foot = placed(box(0.024, 0.012, 0.02), [0, -bucket / 2, 0])
    return merge([rod, hook, foot])
  })
}

export function buildLevers(): {
  parts: PartSpec[]
  leverIds: string[]
  linkIds: string[]
} {
  const b = new PartBuilder('levers', 'LEV')
  const leverIds: string[] = []
  const linkIds: string[] = []
  const keys = keyLayout()

  // 50 键杆：支点到键帽下方的长臂
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    const isSpace = key.fn === 'space'
    const len = isSpace ? 1.2 : key.z - 0.02
    const label = key.char ? `键杆 ${key.char}` : `功能键杆 ${i + 1}`
    const lever = b.add({
      name: label,
      description: key.char
        ? `连接键帽 ${key.char} 与击发机构的细长钢杆，前端承键、后端挂拉线。杆长依键盘行位演绎。`
        : '功能键杆，行程与字符键杆相近（演绎件）。',
      material: 'steelSatin',
      make: () =>
        cached(`lever:${len.toFixed(2)}:${isSpace}`, () =>
          isSpace
            ? merge([
                placed(box(0.5, 0.014, 0.05), [0, 0, 0.5]),
                placed(box(0.04, 0.014, 1.2), [-0.2, 0, 0]),
                placed(box(0.04, 0.014, 1.2), [0.2, 0, 0]),
              ])
            : placed(taperedBar(0.03, 0.024, 0.012, len), [0, 0, len / 2]),
        ),
      assembled: at(
        [key.x * 0.96, 0.42, 0.14],
        [-0.045, key.fn === 'space' ? 0 : key.x * -0.05, 0],
      ),
      exploded: at([key.x * 1.06, 0.16, key.z * 0.5 + 0.32], [-0.045, 0, 0]),
      flatSize: isSpace ? [0.56, 1.25] : [0.06, len + 0.05],
      flatHeight: 0.008,
      flatYaw: key.x * 0.04,
      char: key.char,
    })
    leverIds.push(lever.id)
  }

  // 44 拉线：键杆尾端 → 字杆臂根部
  for (let i = 0; i < CHARS.length; i++) {
    const pivot = barPivot(i)
    const sx = pivot[0] * 0.9
    const sz = 0.34 + Math.abs(pivot[0]) * 0.08
    const sy = 0.36
    const len = Math.hypot(pivot[0] - sx, pivot[1] - sy, pivot[2] - sz)
    const link = b.add({
      name: `拉线 ${CHARS[i]}`,
      description: '键杆与字杆之间的钢丝拉杆，两端弯钩挂接。位置依扇面几何演绎。',
      material: 'steel',
      make: () => pullLink(len),
      assembled: at(
        [(sx + pivot[0]) / 2, (sy + pivot[1]) / 2, (sz + pivot[2]) / 2],
        [
          Math.atan2(pivot[2] - sz, pivot[1] - sy),
          0,
          Math.atan2(pivot[0] - sx, pivot[1] - sy) * -1,
        ],
      ),
      exploded: at(
        [pivot[0] * 1.1, 0.7 + Math.abs(pivot[0]) * 0.15, pivot[2] + 0.55],
        [
          Math.atan2(pivot[2] - sz, pivot[1] - sy),
          0,
          Math.atan2(pivot[0] - sx, pivot[1] - sy) * -1,
        ],
      ),
      flatSize: [0.05, len + 0.05],
      flatHeight: 0.007,
      char: CHARS[i]!,
    })
    linkIds.push(link.id)
  }

  interface Extra {
    name: string
    description: string
    uncertain?: boolean
    make: () => BufferGeometry
    assembled: Transform
    exploded: Transform
    flatSize: [number, number]
    flatHeight: number
  }
  const extras: Extra[] = [
    {
      name: '万向杆',
      description: '横贯全部键杆下方的触杆，任一键按下都会带动它触发换行棘轮（演绎件）。',
      make: () =>
        lathe(
          [
            [0.014, -1.1],
            [0.014, 1.1],
          ],
          10,
        ),
      assembled: at([0, 0.38, 0.3], [0, 0, Math.PI / 2]),
      exploded: at([0, 0.14, 0.72], [0, 0, Math.PI / 2]),
      flatSize: [2.25, 0.05],
      flatHeight: 0.014,
    },
    {
      name: '空格左联杆',
      description: '空格杆左侧向下传动的短连杆。',
      make: () => box(0.03, 0.5, 0.02),
      assembled: at([-0.3, 0.36, 1.6], [0.12, 0, 0]),
      exploded: at([-0.5, 0.14, 1.75], [0.12, 0, 0]),
      flatSize: [0.05, 0.55],
      flatHeight: 0.008,
    },
    {
      name: '空格右联杆',
      description: '空格杆右侧向下传动的短连杆。',
      make: () => box(0.03, 0.5, 0.02),
      assembled: at([0.3, 0.36, 1.6], [0.12, 0, 0]),
      exploded: at([0.5, 0.14, 1.75], [0.12, 0, 0]),
      flatSize: [0.05, 0.55],
      flatHeight: 0.008,
    },
    {
      name: '换档左扳杆',
      description: '左换档键向下的弯杆，通向升降轨。',
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.2, -0.06],
            [0, -0.34, -0.02],
          ],
          0.011,
        ),
      assembled: at([-1.14, 0.4, 1.5], [0, 0, 0.1]),
      exploded: at([-1.4, 0.18, 1.6], [0, 0, 0.3]),
      flatSize: [0.1, 0.42],
      flatHeight: 0.012,
    },
    {
      name: '换档右扳杆',
      description: '右换档键向下的弯杆，通向升降轨。',
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.2, -0.06],
            [0, -0.34, -0.02],
          ],
          0.011,
        ),
      assembled: at([1.14, 0.4, 1.5], [0, 0, -0.1]),
      exploded: at([1.4, 0.18, 1.6], [0, 0, -0.3]),
      flatSize: [0.1, 0.42],
      flatHeight: 0.012,
    },
    {
      name: '退格棘爪杆',
      description: '退格键通向棘轮罩的细杆，含反向棘爪。',
      uncertain: true,
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.1, -0.3],
            [0, -0.12, -0.62],
          ],
          0.01,
        ),
      assembled: at([1.24, 0.44, 0.52], [0, 0, 0]),
      exploded: at([1.5, 0.2, 0.6], [0, 0, -0.2]),
      flatSize: [0.08, 0.7],
      flatHeight: 0.011,
    },
    {
      name: '边距释放杆',
      description: '边距释放键通向字车架锁扣的传动杆。',
      uncertain: true,
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.16, -0.25],
            [0, -0.2, -0.5],
          ],
          0.01,
        ),
      assembled: at([1.2, 0.42, 0.86], [0, 0, 0]),
      exploded: at([1.46, 0.2, 0.9], [0, 0, -0.15]),
      flatSize: [0.08, 0.58],
      flatHeight: 0.011,
    },
    {
      name: '换色选择杆',
      description: '色带黑/红半幅选择杆，拨动它改变导带叉的抬升高度。',
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.12, -0.2],
            [0, -0.14, -0.42],
          ],
          0.01,
        ),
      assembled: at([-1.3, 0.42, 0.9], [0, 0, 0.12]),
      exploded: at([-1.55, 0.2, 1.0], [0, 0, 0.35]),
      flatSize: [0.08, 0.5],
      flatHeight: 0.011,
    },
    {
      name: '制表制动杆',
      description: '制表键通向制表齿条的制动杆。',
      uncertain: true,
      make: () =>
        tubeAlong(
          [
            [0, 0, 0],
            [0, -0.1, -0.3],
            [0, -0.12, -0.6],
          ],
          0.01,
        ),
      assembled: at([-1.26, 0.44, 0.52], [0, 0, 0]),
      exploded: at([-1.55, 0.22, 0.62], [0, 0, 0.2]),
      flatSize: [0.08, 0.68],
      flatHeight: 0.011,
    },
    {
      name: '换行中间杆',
      description: '万向杆与换行棘轮之间的过渡摆杆。',
      uncertain: true,
      make: () =>
        merge([
          placed(box(0.02, 0.2, 0.014), [0, 0.1, 0]),
          placed(box(0.06, 0.02, 0.014), [0.02, 0.19, 0]),
        ]),
      assembled: at([0.36, 0.3, 0.06], [0, 0, -0.1]),
      exploded: at([0.6, 0.12, 0.2], [0, 0, -0.3]),
      flatSize: [0.09, 0.24],
      flatHeight: 0.008,
    },
  ]
  for (const e of extras)
    b.add({
      name: e.name,
      description: e.uncertain ? `${e.description}（未见内部参照，属推测重建）` : e.description,
      material: 'steelSatin',
      certainty: e.uncertain ? 'uncertain' : 'interpreted',
      make: e.make,
      assembled: e.assembled,
      exploded: e.exploded,
      flatSize: e.flatSize,
      flatHeight: e.flatHeight,
    })

  return { parts: b.parts, leverIds, linkIds }
}
