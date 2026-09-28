import type { BufferGeometry } from 'three'
import type { GroupId, MaterialKey, PartSpec, Transform } from './spec'

/**
 * 零件构建辅助：按组分配序列号（SHL-001…），收集零件表。
 * 各组模块创建一个实例，最后导出 parts 数组。
 */

export interface PartInit {
  /** 短名（拼入 id），如「上壳」 */
  name: string
  description: string
  material: MaterialKey
  /** interpreted=依常见结构演绎；uncertain=明确标注推测 */
  certainty?: 'interpreted' | 'uncertain'
  make: () => BufferGeometry
  assembled: Transform
  exploded: Transform
  /** 平铺占地（宽×深）、落地半高、朝向 yaw */
  flatSize: [number, number]
  flatHeight: number
  flatYaw?: number
  /** 组内错峰 0..0.14 */
  stageOffset?: number
  char?: string
}

export class PartBuilder {
  readonly parts: PartSpec[] = []
  private n = 0

  constructor(
    private group: GroupId,
    private prefix: string,
  ) {}

  add(init: PartInit): PartSpec {
    this.n += 1
    const spec: PartSpec = {
      id: `${this.group}__${this.n}`,
      serial: `${this.prefix}-${String(this.n).padStart(3, '0')}`,
      group: this.group,
      name: init.name,
      description: init.description,
      certainty: init.certainty ?? 'interpreted',
      material: init.material,
      make: init.make,
      assembled: init.assembled,
      exploded: init.exploded,
      flatYaw: init.flatYaw ?? 0,
      flatHeight: init.flatHeight,
      flatSize: init.flatSize,
      stageOffset: init.stageOffset ?? 0,
      char: init.char,
    }
    this.parts.push(spec)
    return spec
  }
}

/** 五金等大批小件的批量登记 */
export function addBatch(
  b: PartBuilder,
  count: number,
  init: (i: number) => Omit<PartInit, 'name'> & { name: string },
): void {
  for (let i = 0; i < count; i++) b.add(init(i))
}
