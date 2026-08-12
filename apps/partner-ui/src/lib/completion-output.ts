/**
 * #1271 — the partner side of the completion output gate.
 *
 * The backend (`checkCompletionOutput`) refuses a completion that does not
 * account for everything ordered. Rejects count as output — output that
 * failed — so 9 good + 1 rejected against an order of 10 is complete. What it
 * refuses is units nobody said anything about, unless the completion carries
 * `allow_shortfall: true` AND a written reason.
 *
 * Neither UI had a control for that, so a partner who genuinely made 8 of 10
 * hit a 400 asking for something the form could not send, and the only way
 * through was to raise the produced count — exactly what the gate exists to
 * prevent. This mirrors the gate locally so the form can ask the right
 * question instead of failing the request.
 */
export type CompletionOutputPlan = {
  /** Ordered minus (produced + rejected), never negative. */
  unaccounted: number
  /** Whether the request must declare a shortfall. */
  allowShortfall: boolean
  /** Set when the partner must still say what happened to the missing units. */
  needsReason: boolean
  /** The shortfall line to prepend to `notes`, or null when there is none. */
  noteLine: string | null
}

export const planCompletionOutput = (input: {
  ordered: number
  produced: number
  rejected: number
  shortfallReason?: string
}): CompletionOutputPlan => {
  const ordered = Number(input.ordered)
  const produced = Number(input.produced) || 0
  const rejected = Number(input.rejected) || 0

  // No ordered quantity to measure against — the backend enforces nothing
  // here either, so neither should the form.
  if (!Number.isFinite(ordered) || ordered <= 0) {
    return {
      unaccounted: 0,
      allowShortfall: false,
      needsReason: false,
      noteLine: null,
    }
  }

  const unaccounted = Math.max(0, ordered - (produced + rejected))
  const reason = (input.shortfallReason || "").trim()

  if (unaccounted <= 0) {
    return {
      unaccounted: 0,
      allowShortfall: false,
      needsReason: false,
      noteLine: null,
    }
  }

  return {
    unaccounted,
    allowShortfall: true,
    needsReason: !reason,
    noteLine: reason
      ? `Shortfall: ${unaccounted} of ${ordered} not produced — ${reason}`
      : null,
  }
}
