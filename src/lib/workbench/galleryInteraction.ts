import type { ProductPresentation } from './types'
import { progressActions } from './motionConfig'
import { exhibitMotionSteps } from './exhibitionMotion'

/** Local presentation policy; generic exhibits use the same contract, not another page. */
export function galleryInteraction(presentation?: ProductPresentation) {
  const motions = presentation ? progressActions(presentation) : []
  const chapterMotion = motions.find((action) => action.motion.program)
  const program = chapterMotion?.motion.program?.type
  const steps = chapterMotion
    ? exhibitMotionSteps(chapterMotion).map((step, index) => ({
        ...step,
        label: program === 'typewriter-layout-v1' ? ['整机', '分层', '平铺'][index]! : step.label,
      }))
    : []
  return {
    chapterMotion,
    steps,
    numbered: program === 'piano-sound-path-v1',
    independent: motions.filter((action) => action !== chapterMotion),
    actions: presentation?.actions.filter((action) => action.kind !== 'progress') ?? [],
    cabin:
      presentation?.source.kind === 'glb' && presentation.source.adapter === 'reventon-v1'
        ? presentation.views.find((view) => view.id === 'car-cabin')
        : undefined,
  }
}
