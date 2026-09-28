/**
 * 打字机研究的场景↔UI 桥。
 * 场景组件挂载时注册实现，卸载时还原为空操作。
 * 单一实例：研究体验同时只存在一个 Canvas。
 */

export interface StudyBridge {
  /** 经平滑后的显示进度（相机与模型共用） */
  displayedProgress: number
  /** 平铺版面尺寸（相机取景用） */
  flatWidth: number
  flatDepth: number
  /** 缩放倍率（>1 拉远） */
  zoom: (factor: number) => void
  /** 屏幕坐标拾取零件 id */
  pick: (clientX: number, clientY: number) => string | null
  /** 零件当前世界坐标的屏幕投影（tooltip 用） */
  screenPos: (id: string) => { x: number; y: number } | null
  /** 零件当前世界坐标与半径（检视相机用） */
  partWorld: (id: string) => { center: [number, number, number]; radius: number } | null
  /** 恢复相机默认位（保留进度） */
  resetCamera: () => void
}

export const studyBridge: StudyBridge = {
  displayedProgress: 0,
  flatWidth: 8,
  flatDepth: 4.5,
  zoom: () => {},
  pick: () => null,
  screenPos: () => null,
  partWorld: () => null,
  resetCamera: () => {},
}
