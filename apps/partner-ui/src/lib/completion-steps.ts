/**
 * #2440 — on a phone the completion form is one screen per step instead of
 * one long page: the material rows were what pushed it past the screen edge.
 * Desktop still shows every section at once.
 */
export const COMPLETION_STEPS = [
  { key: "output", label: "Output" },
  { key: "materials", label: "Materials" },
  { key: "cost", label: "Cost & notes" },
] as const

export type CompletionStepKey = (typeof COMPLETION_STEPS)[number]["key"]

/** Where Back/Next go from `index`, clamped to the step list. */
export const completionStepNav = (index: number) => {
  const last = COMPLETION_STEPS.length - 1
  const at = Math.min(Math.max(index, 0), last)
  return {
    index: at,
    step: COMPLETION_STEPS[at],
    isFirst: at === 0,
    isLast: at === last,
    prev: Math.max(at - 1, 0),
    next: Math.min(at + 1, last),
  }
}

/**
 * Whether a section renders. Every section shows when the form is not
 * stepped (desktop); on a phone only the current step's does.
 */
export const showCompletionSection = (
  section: CompletionStepKey,
  stepped: boolean,
  currentIndex: number
) => !stepped || completionStepNav(currentIndex).step.key === section
