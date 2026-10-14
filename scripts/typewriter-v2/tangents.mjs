/** Correct unusable Mikk fallback vectors without altering source normals or valid Mikk directions. */
export function orthogonalizeTangents(tangents, normals) {
  let repaired = 0
  for (let vertex = 0; vertex < tangents.length / 4; vertex++) {
    const t = vertex * 4,
      n = vertex * 3
    const length = Math.hypot(normals[n], normals[n + 1], normals[n + 2])
    if (!(length > 1e-8)) throw new Error('Cannot author tangent for a zero source normal')
    const nx = normals[n] / length,
      ny = normals[n + 1] / length,
      nz = normals[n + 2] / length
    let x = tangents[t],
      y = tangents[t + 1],
      z = tangents[t + 2]
    const dot = x * nx + y * ny + z * nz
    if (Math.abs(dot) < 1e-5 && Math.abs(Math.hypot(x, y, z) - 1) < 1e-5) continue
    x -= nx * dot
    y -= ny * dot
    z -= nz * dot
    let size = Math.hypot(x, y, z)
    if (!(size > 1e-8)) {
      // Least-aligned cardinal axis projected into the tangent plane.
      const axis = [Math.abs(nx), Math.abs(ny), Math.abs(nz)].indexOf(
        Math.min(Math.abs(nx), Math.abs(ny), Math.abs(nz)),
      )
      x = axis === 0 ? 1 : 0
      y = axis === 1 ? 1 : 0
      z = axis === 2 ? 1 : 0
      const d = x * nx + y * ny + z * nz
      x -= nx * d
      y -= ny * d
      z -= nz * d
      size = Math.hypot(x, y, z)
    }
    tangents[t] = x / size
    tangents[t + 1] = y / size
    tangents[t + 2] = z / size
    repaired++
  }
  return repaired
}
