import { Matrix4 } from 'three'
import type { Node, PerspectiveCamera, TextureNode } from 'three/webgpu'
import {
  float,
  getViewPosition,
  smoothstep,
  uniform,
  unpackRGBToNormal,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import type { SpeedballProbeNode } from 'speedball-gi'
import type { createDdgiVolume } from './contract'

export interface DdgiReceiverInputs {
  depth: TextureNode
  normal: TextureNode
  camera: PerspectiveCamera
}

/** Sample linear irradiance only. The compositor owns Lambert 1/π, base color,
 * metalness, coat, native diffuse replacement and transparent transmittance.
 * The G-buffer shading normal is used for both visibility and direction here;
 * unlike the installer this receiver cannot access object-space vertex normals.
 */
export function createDdgiReceiver(
  probe: SpeedballProbeNode,
  inputs: DdgiReceiverInputs,
  volume: ReturnType<typeof createDdgiVolume>,
): { irradiance: Node<'vec3'>; validity: Node<'float'> } {
  const inverseProjection = uniform(new Matrix4()).onRenderUpdate((_frame, self) =>
      self.value.copy(inputs.camera.projectionMatrixInverse),
    ),
    worldMatrix = uniform(new Matrix4()).onRenderUpdate((_frame, self) =>
      self.value.copy(inputs.camera.matrixWorld),
    ),
    coordinate = uv(),
    depth = inputs.depth.sample(coordinate).r,
    viewPosition = getViewPosition(coordinate, depth, inverseProjection),
    worldPosition = worldMatrix.mul(vec4(viewPosition, 1)).xyz,
    normal = worldMatrix
      .mul(vec4(unpackRGBToNormal(inputs.normal.sample(coordinate).rgb), 0))
      .xyz.normalize(),
    min = vec3(volume.box.min),
    max = vec3(volume.box.max),
    inside = worldPosition.x
      .greaterThanEqual(min.x)
      .and(worldPosition.y.greaterThanEqual(min.y))
      .and(worldPosition.z.greaterThanEqual(min.z))
      .and(worldPosition.x.lessThanEqual(max.x))
      .and(worldPosition.y.lessThanEqual(max.y))
      .and(worldPosition.z.lessThanEqual(max.z)),
    validDepth = depth.greaterThanEqual(0).and(depth.lessThan(1)),
    distances = worldPosition.sub(min).min(max.sub(worldPosition)),
    edgeDistance = distances.x.min(distances.y).min(distances.z),
    boundaryWeight =
      volume.blendWidth > 0 ? smoothstep(0, volume.blendWidth, edgeDistance) : float(1),
    validity = inside.and(validDepth).select(boundaryWeight, float(0)),
    biased = worldPosition.add(
      normal.mul(probe.normalBiasNode[0]!.value).mul(probe.sampleBiasScaleNode.value),
    ),
    irradiance = probe
      .sampleIrradiance(biased, normal, normal)
      .max(vec3(0))
      .mul(probe.intensityNode)
      .mul(probe.enabledNode)
  return { irradiance, validity }
}
