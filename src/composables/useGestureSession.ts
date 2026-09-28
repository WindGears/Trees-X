import { onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useGestureInput } from './useGestureInput'
import type { Point } from '@/lib/gesture/detector'
import type { GestureBridge } from '@/lib/gesture/bridge'

export function useGestureSession(
  video: Ref<HTMLVideoElement | null>,
  active: Ref<boolean>,
  bridge: GestureBridge,
) {
  const status = ref<'off' | 'starting' | 'running' | 'error'>('off')
  const message = ref('摄像头默认关闭，画面仅在本机处理。')
  const inferenceMs = ref(0)
  const input = useGestureInput(video, bridge)
  let inputEpoch = 0
  let worker: Worker | undefined, stream: MediaStream | undefined
  let generation = 0,
    timer = 0,
    timeout = 0,
    watchdog = 0
  let busy = false,
    lastVideoTime = -1
  bridge.reset = (preserveSelectionBlock = false) => {
    inputEpoch++
    bridge.inputRevision++
    input.reset(preserveSelectionBlock)
  }
  function stop(note = '摄像头已关闭。') {
    bridge.sessionRunning.value = false
    generation++
    window.clearInterval(timer)
    window.clearTimeout(timeout)
    window.clearTimeout(watchdog)
    stream?.getTracks().forEach((track) => track.stop())
    stream = undefined
    if (video.value) video.value.srcObject = null
    worker?.postMessage({ type: 'close' })
    worker?.terminate()
    worker = undefined
    busy = false
    lastVideoTime = -1
    bridge.takeMouse()
    status.value = 'off'
    message.value = note
  }
  function fail(note: string) {
    stop(note)
    status.value = 'error'
  }
  async function start() {
    stop()
    if (!active.value || document.hidden) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fail('当前环境无法访问摄像头，请使用 HTTPS 或 localhost。')
      return
    }
    status.value = 'starting'
    message.value = '请允许摄像头访问，正在准备手势识别…'
    const id = generation
    timeout = window.setTimeout(() => {
      if (id === generation) fail('准备超时，请重试或继续用鼠标浏览。')
    }, 45_000)
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      if (id !== generation) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      acquired.getVideoTracks()[0]?.addEventListener(
        'ended',
        () => {
          if (id === generation) fail('摄像头连接已断开，请重新开启。')
        },
        { once: true },
      )
      if (!video.value) throw new Error('video missing')
      video.value.srcObject = acquired
      await video.value.play()
      if (id !== generation) return
      worker = new Worker(new URL(`${import.meta.env.BASE_URL}gesture/worker.js`, location.href))
      worker.onerror = () => {
        if (id === generation) fail('识别模块无法运行，请重试。')
      }
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        type: string
        points: Point[]
        time: number
        inferenceMs: number
        epoch: number
        aspect: number
      }>) => {
        if (id !== generation) return
        if (data.type === 'error') {
          fail('识别资源加载或处理失败，请重试。')
          return
        }
        if (data.type === 'ready') {
          window.clearTimeout(timeout)
          status.value = 'running'
          bridge.sessionRunning.value = true
          bridge.owner.value = 'gesture'
          message.value = '识别已开启。张掌左右移动，或切换到选择模式。'
          timer = window.setInterval(() => void frame(id), 1000 / 15)
        }
        if (data.type === 'result') {
          busy = false
          window.clearTimeout(watchdog)
          inferenceMs.value = Math.round(data.inferenceMs)
          if (data.epoch !== inputEpoch) return
          if (!active.value || !bridge.sceneActive.value || bridge.owner.value !== 'gesture') {
            bridge.reset()
            return
          }
          input.process(data.points, data.time, data.aspect)
        }
      }
      worker.postMessage({ type: 'init' })
    } catch (error) {
      if (id !== generation) return
      const name = error instanceof DOMException ? error.name : ''
      fail(
        name === 'NotAllowedError'
          ? '未获得摄像头权限。仍可使用鼠标和键盘浏览。'
          : name === 'NotFoundError'
            ? '没有找到摄像头。'
            : name === 'NotReadableError'
              ? '摄像头可能被其他应用占用，请关闭占用后重试。'
              : '无法启动摄像头，请检查设备后重试。',
      )
    }
  }
  async function frame(id: number) {
    const element = video.value
    if (
      !element ||
      busy ||
      !active.value ||
      !bridge.sceneActive.value ||
      bridge.owner.value !== 'gesture' ||
      element.readyState < 2 ||
      element.currentTime === lastVideoTime
    )
      return
    busy = true
    lastVideoTime = element.currentTime
    const epoch = inputEpoch
    const capturedAt = performance.now()
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(element)
      if (id !== generation || epoch !== inputEpoch) {
        bitmap.close()
        if (id === generation) busy = false
        return
      }
      worker?.postMessage({ type: 'frame', frame: bitmap, time: capturedAt, epoch }, [bitmap])
      bitmap = undefined
      watchdog = window.setTimeout(() => {
        if (id === generation) fail('识别暂时无响应，请重新开启。')
      }, 5000)
    } catch {
      bitmap?.close()
      if (id === generation) fail('无法读取视频帧，请重新开启。')
    }
  }
  const visibility = () => {
    if (document.hidden) stop('页面已进入后台，摄像头已关闭。请手动重新开启。')
  }
  document.addEventListener('visibilitychange', visibility)
  watch([active, bridge.sceneActive], ([available, visible]) => {
    if (!available || !visible) {
      bridge.reset()
      bridge.pointer.value = null
    }
  })
  watch(
    [bridge.mode, bridge.confirmation],
    () => {
      bridge.reset()
      bridge.pointer.value = null
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    stop()
    document.removeEventListener('visibilitychange', visibility)
  })
  return { status, message, inferenceMs, start, stop, ...input }
}
