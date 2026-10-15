export type StudioMood = 'light' | 'dark'
export interface StudioEnvironmentStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}
export type StudioMoodUpdate = {
  mood: StudioMood
  changed: () => void
  report: (status: StudioEnvironmentStatus) => void
}
