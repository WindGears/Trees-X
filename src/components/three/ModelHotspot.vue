<script setup lang="ts">
import { inject, onScopeDispose } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import { Box3, Vector3 } from 'three'
import type { Group } from 'three'
import { gestureKey } from '@/lib/gesture/bridge'
import { useProductStore } from '@/stores/product'
import type { ModelSelection } from '@/lib/three/modelSelection'

const props = defineProps<{ model: Group; selection: ModelSelection }>()
const bridge = inject(gestureKey)!
const store = useProductStore()
const { camera } = useTres()
const { onBeforeRender } = useLoop()
const projection = new Vector3()
const isCurrent = () =>
  store.product.id === props.selection.product.id &&
  store.selectionRevision === props.selection.revision
const anchors = props.selection.product.hotspots.flatMap((part) => {
  const node = props.model.getObjectByName(part.node)
  if (!node) return []
  node.updateWorldMatrix(true, true)
  const local = part.localPoint
    ? new Vector3(...part.localPoint)
    : node.worldToLocal(new Box3().setFromObject(node).getCenter(new Vector3()))
  return [{ part, node, local, world: new Vector3() }]
})
bridge.projectedParts.value = anchors.map(({ part }) => ({
  id: `part:${part.id}`,
  partId: part.id,
  label: part.name,
  x: 0.5,
  y: 0.5,
  visible: false,
}))
const projected = bridge.projectedParts.value
const unregister = anchors.map(({ part }, i) =>
  bridge.targets.register(`part:${part.id}`, () => ({
    ...projected[i]!,
    priority: 0,
    visible:
      isCurrent() &&
      projected[i]!.visible &&
      bridge.sceneActive.value &&
      bridge.owner.value !== 'animation',
    activate: () => {
      if (!isCurrent()) return
      store.activePartId = part.id
      bridge.showPart()
    },
  })),
)
const getFocusPoint = () => {
  if (!isCurrent()) return null
  const anchor = anchors.find(({ part }) => part.id === store.activePartId)
  if (!anchor) return null
  anchor.node.updateWorldMatrix(true, false)
  return anchor.node.localToWorld(anchor.world.copy(anchor.local))
}
bridge.getFocusPoint = getFocusPoint
onBeforeRender(() => {
  const instance = camera.value
  if (!instance || !isCurrent()) return
  for (let i = 0; i < anchors.length; i++) {
    const { node, local, world, part } = anchors[i]!
    node.updateWorldMatrix(true, false)
    node.localToWorld(world.copy(local))
    projection.copy(world).project(instance)
    const target = projected[i]!
    target.x = (projection.x + 1) / 2
    target.y = (1 - projection.y) / 2
    target.visible =
      (part.face === 'any' ||
        (part.face === 'top'
          ? instance.position.y > world.y + 0.2
          : instance.position.z > world.z + 0.3)) &&
      Math.abs(projection.x) < 0.94 &&
      Math.abs(projection.y) < 0.94 &&
      projection.z > -1 &&
      projection.z < 1
    if (part.id === store.activePartId) {
      bridge.hotspot.value.x = target.x
      bridge.hotspot.value.y = target.y
      bridge.hotspot.value.visible = target.visible
    }
  }
})
onScopeDispose(() => {
  unregister.forEach((remove) => remove())
  if (bridge.projectedParts.value === projected) {
    bridge.projectedParts.value = []
    bridge.hotspot.value.visible = false
  }
  if (bridge.getFocusPoint === getFocusPoint) bridge.getFocusPoint = () => null
})
</script>
<template><TresGroup /></template>
