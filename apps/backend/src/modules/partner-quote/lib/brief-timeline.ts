/**
 * #2608 — when could her pieces be ready, against the date she needs them?
 *
 * Steps run one after another (fabric → print → stitch). A step's days come
 * from the partner's rate (`lead_days`), else our estimate on the step. With
 * no pick yet, the range spans every partner offered. A step with no figure is
 * listed as "we'll confirm" and the verdict stays honest: it never says "on
 * track" while a step is unknown. Shipping is not included, and says so.
 */
export type TimelineStepInput = {
  label: string
  state: "estimated" | "ask" | "exploring"
  lead_days: number | null
  selected_choice_id: string | null
  choices: { id: string; estimate: { lead_days: number | null } | null }[]
}

export type BriefTimeline = {
  sample_days: number | null
  production_low: number | null
  production_high: number | null
  unknown_steps: string[]
  /** Earliest ready dates if she approves samples the day they arrive. */
  ready_low: string | null
  ready_high: string | null
  deadline: string | null
  verdict: "on_track" | "tight" | "too_soon" | "unknown" | null
}

const TIGHT_MARGIN_DAYS = 7
const DAY = 86_400_000

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export const timelineOption = (
  steps: TimelineStepInput[],
  sampleDays: number | null,
  deadline: string | null,
  now: Date = new Date()
): BriefTimeline => {
  let low = 0
  let high = 0
  const unknown: string[] = []
  for (const s of steps) {
    if (s.state === "exploring") {
      unknown.push(s.label)
      continue
    }
    const pool = s.selected_choice_id ? s.choices.filter((c) => c.id === s.selected_choice_id) : s.choices
    const days = pool
      .map((c) => c.estimate?.lead_days ?? s.lead_days)
      .filter((d): d is number => typeof d === "number" && d > 0)
    if (!days.length) {
      unknown.push(s.label)
      continue
    }
    low += Math.min(...days)
    high += Math.max(...days)
  }

  const known = unknown.length === 0
  const production_low = known || low ? low : null
  const production_high = known || high ? high : null
  const total = (p: number | null) => (sampleDays != null && p != null ? sampleDays + p : null)
  const needLow = total(production_low)
  const needHigh = total(production_high)

  let verdict: BriefTimeline["verdict"] = null
  const dl = deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? new Date(`${deadline}T00:00:00Z`) : null
  if (dl) {
    const available = Math.floor((dl.getTime() - now.getTime()) / DAY)
    if (needLow != null && needLow > available) verdict = "too_soon" // even the known part doesn't fit
    else if (!known || needHigh == null) verdict = "unknown"
    else if (needHigh <= available - TIGHT_MARGIN_DAYS) verdict = "on_track"
    else verdict = "tight"
  }

  return {
    sample_days: sampleDays,
    production_low: known ? production_low : null,
    production_high: known ? production_high : null,
    unknown_steps: unknown,
    ready_low: known && needLow != null ? isoDay(new Date(now.getTime() + needLow * DAY)) : null,
    ready_high: known && needHigh != null ? isoDay(new Date(now.getTime() + needHigh * DAY)) : null,
    deadline: dl ? isoDay(dl) : null,
    verdict,
  }
}
