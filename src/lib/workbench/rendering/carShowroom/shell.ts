import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { CarShowroomConfig } from './config'

type BoundaryPoint = { x: number; z: number; nx: number; nz: number; distance: number }
type BoundaryPiece = { id: string; points: BoundaryPoint[] }

/** One closed, rounded perimeter shared by floor, cove, walls and ceiling. */
function roomPerimeter(config: CarShowroomConfig): BoundaryPiece[] {
  const [minX, , minZ] = config.roomBox.min,
    [maxX, , maxZ] = config.roomBox.max,
    radius = config.coveRadius * 2,
    cornerSegments = 24,
    pieces: BoundaryPiece[] = [],
    sides = [
      {
        id: 'back',
        start: [minX + radius, minZ],
        end: [maxX - radius, minZ],
        center: [maxX - radius, minZ + radius],
        angle: -Math.PI / 2,
      },
      {
        id: 'right',
        start: [maxX, minZ + radius],
        end: [maxX, maxZ - radius],
        center: [maxX - radius, maxZ - radius],
        angle: 0,
      },
      {
        id: 'front',
        start: [maxX - radius, maxZ],
        end: [minX + radius, maxZ],
        center: [minX + radius, maxZ - radius],
        angle: Math.PI / 2,
      },
      {
        id: 'left',
        start: [minX, maxZ - radius],
        end: [minX, minZ + radius],
        center: [minX + radius, minZ + radius],
        angle: Math.PI,
      },
    ] as const
  if (radius <= 0 || radius * 2 >= Math.min(maxX - minX, maxZ - minZ))
    throw new Error('Cold studio requires a positive cove radius smaller than a quarter room width')
  let distance = 0
  for (const side of sides) {
    const normalX = Math.cos(side.angle),
      normalZ = Math.sin(side.angle),
      points: BoundaryPoint[] = [
        { x: side.start[0], z: side.start[1], nx: normalX, nz: normalZ, distance },
      ],
      straightLength = Math.hypot(side.end[0] - side.start[0], side.end[1] - side.start[1])
    distance += straightLength
    for (let step = 0; step <= cornerSegments; step++) {
      const angle = side.angle + ((step / cornerSegments) * Math.PI) / 2,
        nx = Math.cos(angle),
        nz = Math.sin(angle)
      points.push({
        x: side.center[0] + radius * nx,
        z: side.center[1] + radius * nz,
        nx,
        nz,
        distance: distance + ((step / cornerSegments) * radius * Math.PI) / 2,
      })
    }
    distance += (radius * Math.PI) / 2
    pieces.push({ id: side.id, points })
  }
  return pieces
}

function geometry(positions: number[], normals: number[], uvs: number[], indices: number[]) {
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  result.setIndex(indices)
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

function strip(config: CarShowroomConfig, piece: BoundaryPiece, cove: boolean) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    rows = cove ? 32 : 1,
    columns = piece.points.length,
    radius = config.coveRadius
  for (let row = 0; row <= rows; row++) {
    const angle = ((row / rows) * Math.PI) / 2,
      inset = cove ? radius * (1 - Math.sin(angle)) : 0,
      y = cove
        ? config.groundY + radius * (1 - Math.cos(angle))
        : row === 0
          ? config.groundY + radius
          : config.roomBox.max[1],
      v = cove ? radius * angle : (radius * Math.PI) / 2 + y - config.groundY - radius
    for (const point of piece.points) {
      positions.push(point.x - point.nx * inset, y, point.z - point.nz * inset)
      normals.push(
        -point.nx * (cove ? Math.sin(angle) : 1),
        cove ? Math.cos(angle) : 0,
        -point.nz * (cove ? Math.sin(angle) : 1),
      )
      // Metric UVs, two scene metres per image repeat, continuous around corners.
      uvs.push(point.distance / 1.5, v / 1.5)
    }
    if (row < rows)
      for (let column = 0; column < columns - 1; column++) {
        const a = row * columns + column,
          b = a + 1,
          c = a + columns,
          d = c + 1
        indices.push(a, b, c, b, d, c)
      }
  }
  return geometry(positions, normals, uvs, indices)
}

function cap(config: CarShowroomConfig, pieces: BoundaryPiece[], floor: boolean) {
  const outline = pieces.flatMap((piece) => piece.points.slice(0, -1)),
    inset = floor ? config.coveRadius : 0,
    centerX = (config.roomBox.min[0] + config.roomBox.max[0]) / 2,
    centerZ = (config.roomBox.min[2] + config.roomBox.max[2]) / 2,
    positions = [centerX, 0, centerZ],
    normals = [0, floor ? 1 : -1, 0],
    uvs = [centerX / 2.5, -centerZ / 2.5],
    indices: number[] = []
  for (const point of outline) {
    const x = point.x - point.nx * inset,
      z = point.z - point.nz * inset
    positions.push(x, 0, z)
    normals.push(0, floor ? 1 : -1, 0)
    uvs.push(x / 2.5, -z / 2.5)
  }
  for (let index = 0; index < outline.length; index++) {
    const a = index + 1,
      b = ((index + 1) % outline.length) + 1
    indices.push(...(floor ? [0, b, a] : [0, a, b]))
  }
  return geometry(positions, normals, uvs, indices)
}

/** Geometry is split only for camera cutaway; every shared boundary is identical. */
export function createStudioShell(config: CarShowroomConfig) {
  const pieces = roomPerimeter(config)
  return {
    floor: cap(config, pieces, true),
    ceiling: cap(config, pieces, false),
    walls: pieces.map((piece) => ({
      id: `${piece.id} wall`,
      geometry: strip(config, piece, false),
    })),
    coves: pieces.map((piece) => ({
      id: `${piece.id} floor cove`,
      geometry: strip(config, piece, true),
    })),
  }
}
