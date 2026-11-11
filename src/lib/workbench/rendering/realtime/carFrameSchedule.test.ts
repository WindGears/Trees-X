import { describe, expect, it, vi } from 'vitest'
import { createCarFrameSchedule } from './carFrameSchedule'

describe('R18 frame scheduling', () => {
  it('settles the existing render loop and gives a fresh budget to real changes', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const schedule = createCarFrameSchedule()
      schedule.configure(true)
      clock.mockReturnValue(900)
      for (let i = 0; i < 32; i++) {
        expect(schedule.unsettled()).toBe(true)
        schedule.submitted()
      }
      expect(schedule.unsettled()).toBe(false)
      schedule.touch()
      expect(schedule.unsettled()).toBe(true)
      schedule.configure()
      expect(schedule.unsettled()).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })

  it('allows showroom fades to finish after the required history frames', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      const schedule = createCarFrameSchedule()
      schedule.configure(true)
      for (let i = 0; i < 32; i++) schedule.submitted()
      clock.mockReturnValue(800)
      expect(schedule.unsettled()).toBe(true)
      clock.mockReturnValue(850)
      expect(schedule.unsettled()).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })
})
