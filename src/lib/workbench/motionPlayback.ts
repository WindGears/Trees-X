import { gsap } from 'gsap'
import type { SceneAdapter } from './adapter'
import { clampProgress } from './motionPose'
import type { MotionCommand, MotionStatus, ProgressAction } from './types'

export type MotionFeedback = (id: string, status: MotionStatus) => void

export function createMotionPlayback(
  adapter: SceneAdapter,
  actions: ProgressAction[],
  invalidate: () => void,
  feedback: MotionFeedback,
  reduced: () => boolean,
  checkpoint: Record<string, MotionStatus> = {},
) {
  interface Channel {
    action: ProgressAction
    status: MotionStatus
    lastReport: number
    tween?: gsap.core.Tween
  }
  const channels = new Map(
    actions.map((action) => {
      const saved = checkpoint[action.id]
      const status: MotionStatus = {
        progress: clampProgress(saved?.progress ?? 0),
        target: saved?.target ?? 1,
        playing: false,
      }
      adapter.pose[action.id] = status.progress
      return [action.id, { action, status, lastReport: -Infinity }] as [string, Channel]
    }),
  )
  let disposed = false
  function report(channel: Channel, force = false) {
    const now = performance.now()
    if (!disposed && (force || now - channel.lastReport >= 1000 / 15)) {
      channel.lastReport = now
      feedback(channel.action.id, {
        progress: channel.status.progress,
        target: channel.status.target,
        playing: channel.status.playing,
      })
    }
  }
  function apply(channel: Channel, force = false) {
    adapter.pose[channel.action.id] = channel.status.progress
    adapter.apply()
    invalidate()
    report(channel, force)
  }
  function pause(channel: Channel) {
    channel.tween?.kill()
    channel.tween = undefined
    channel.status.playing = false
    report(channel, true)
  }
  function pauseAll() {
    for (const channel of channels.values()) pause(channel)
  }
  function play(channel: Channel, target: number) {
    pauseAll()
    channel.status.target = clampProgress(target)
    const distance = Math.abs(channel.status.progress - channel.status.target)
    if (reduced() || distance < 1e-8) {
      channel.status.progress = channel.status.target
      apply(channel, true)
      return
    }
    channel.status.playing = true
    channel.tween = gsap.to(channel.status, {
      progress: channel.status.target,
      duration: distance * channel.action.motion.duration,
      ease: 'none',
      onUpdate: () => apply(channel),
      onComplete: () => {
        channel.tween = undefined
        channel.status.playing = false
        apply(channel, true)
      },
    })
    report(channel, true)
  }
  adapter.apply()
  for (const channel of channels.values()) report(channel, true)
  return {
    pauseAll,
    command(command: MotionCommand) {
      if (disposed) return
      const channel = channels.get(command.id)
      if (!channel) return
      if (command.operation === 'pause') pause(channel)
      else if (command.operation === 'play') play(channel, command.value ?? 1)
      else if (command.operation === 'resume') play(channel, channel.status.target)
      else {
        pauseAll()
        channel.status.progress = clampProgress(
          command.operation === 'reset' ? 0 : (command.value ?? 0),
        )
        if (command.operation === 'reset') channel.status.target = 1
        apply(channel, true)
      }
    },
    reset() {
      pauseAll()
      for (const channel of channels.values()) {
        channel.status.progress = 0
        channel.status.target = 1
        adapter.pose[channel.action.id] = 0
        report(channel, true)
      }
      adapter.apply()
      invalidate()
    },
    dispose() {
      pauseAll()
      disposed = true
      channels.clear()
    },
  }
}
