import {
  Box3,
  BoxGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  type Material,
} from 'three'

/** Grounded in a 101-pose, every-vertex audit of the current v2 GLB and rig. */
export const loungeTableDimensions = {
  width: 8.4,
  depth: 4.8,
  slabHeight: 0.26,
  bodyHeight: 2.2,
  radius: 0.1,
} as const

export const loungeMotionBounds = {
  min: [-3.073813332878237, 0.00559999999999997, -1.7225000000015003],
  max: [3.688178358686069, 1.6148447646488844, 1.7224999999985002],
  samples: 101,
  scale: 0.16,
} as const

export interface LoungeTableOptions {
  groundY: number
  topMaterial?: Material
  sideMaterial?: Material
  bodyMaterial?: Material
}

function outline(width: number, depth: number, radius: number) {
  const shape = new Shape(),
    x = -width / 2,
    z = -depth / 2
  shape.moveTo(x + radius, z)
  shape.lineTo(x + width - radius, z)
  shape.quadraticCurveTo(x + width, z, x + width, z + radius)
  shape.lineTo(x + width, z + depth - radius)
  shape.quadraticCurveTo(x + width, z + depth, x + width - radius, z + depth)
  shape.lineTo(x + radius, z + depth)
  shape.quadraticCurveTo(x, z + depth, x, z + depth - radius)
  shape.lineTo(x, z + radius)
  shape.quadraticCurveTo(x, z, x + radius, z)
  return shape
}

/** Derived geometry/material ownership only; all supplied materials are borrowed. */
export function createLoungeSpatialTable(options: LoungeTableOptions) {
  if (!Number.isFinite(options.groundY)) throw new Error('桌台顶面高度无效')
  const { width, depth, slabHeight, bodyHeight, radius } = loungeTableDimensions,
    bevel = 0.04,
    owned: Material[] = [],
    own = <T extends Material>(material: T) => {
      owned.push(material)
      return material
    },
    topMaterial =
      options.topMaterial ??
      own(new MeshPhysicalMaterial({ color: '#504337', roughness: 0.34, clearcoat: 0.18 })),
    sideMaterial =
      options.sideMaterial ??
      own(new MeshPhysicalMaterial({ color: '#40362c', roughness: 0.42, clearcoat: 0.1 })),
    bodyMaterial =
      options.bodyMaterial ??
      own(new MeshStandardMaterial({ color: new Color('#211914'), roughness: 0.7 })),
    slabGeometry = new ExtrudeGeometry(outline(width - bevel * 2, depth - bevel * 2, radius), {
      depth: slabHeight - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 10,
      steps: 1,
    })
  // Shape XY -> horizontal XZ; extrude Z becomes world Y. Top stays exactly groundY.
  slabGeometry.rotateX(-Math.PI / 2)
  slabGeometry.translate(0, -slabHeight + bevel, 0)
  const positions = slabGeometry.getAttribute('position'),
    normals = slabGeometry.getAttribute('normal'),
    coordinates = slabGeometry.getAttribute('uv')
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i)
    if (Math.abs(normals.getY(i)) > 0.9) coordinates.setXY(i, x / width + 0.5, -z / depth + 0.5)
    else
      coordinates.setXY(
        i,
        Math.abs(normals.getX(i)) > Math.abs(normals.getZ(i)) ? z / depth + 0.5 : x / width + 0.5,
        (y + slabHeight) / slabHeight,
      )
  }
  // ExtrudeGeometry reserves material 0 for the caps and material 1 for side/bevel.
  const top = new Mesh<ExtrudeGeometry, Material | Material[]>(slabGeometry, [
      topMaterial,
      sideMaterial,
    ]),
    bodyGeometry = new BoxGeometry(width - 0.75, bodyHeight, depth - 0.75),
    body = new Mesh(bodyGeometry, bodyMaterial),
    group = new Group(),
    floorY = options.groundY - slabHeight - bodyHeight
  group.name = 'Trees X / spatial lounge table'
  group.userData.loungeSpatialTable = true
  group.userData.motionCoverage = loungeMotionBounds
  top.name = 'Trees X / thick stone tabletop'
  top.position.y = options.groundY
  top.receiveShadow = true
  top.castShadow = true
  body.name = 'Trees X / grounded table body'
  body.position.y = floorY + bodyHeight / 2
  body.receiveShadow = body.castShadow = true
  group.add(top, body)
  group.updateMatrixWorld(true)
  let disposed = false
  return {
    group,
    top,
    side: top,
    body,
    dimensions: loungeTableDimensions,
    groundY: options.groundY,
    floorY,
    bounds: new Box3().setFromObject(group),
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      slabGeometry.dispose()
      bodyGeometry.dispose()
      for (const material of owned) material.dispose()
    },
  }
}
