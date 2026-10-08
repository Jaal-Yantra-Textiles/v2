/**
 * Reminders on ONE production run can be paused by an admin.
 *
 * The daily reminder flow nags (and at the cap re-sends to) every run that
 * is sent and not accepted. There was no way to quiet a single run: Chupa
 * embroidery (2026-10-08) had been sent before the order was reversed, and
 * the next reminder would have told Embroprint to start work that must wait
 * for Sharlho's stitching. The only levers were switching the whole flow off
 * (every partner) or accepting on the partner's behalf (a false record).
 *
 * Stored on run.metadata so it needs no migration. A pause holds until an
 * admin lifts it; it does not expire on its own.
 */
export type ReminderPause = { paused_at: string; reason: string | null; by: string | null }

export function reminderPauseOf(run: { metadata?: Record<string, any> | null } | null | undefined): ReminderPause | null {
  const p = run?.metadata?.reminders_paused
  return p && typeof p === "object" && p.paused_at ? (p as ReminderPause) : null
}

/** The run's metadata with the pause set or cleared; other keys untouched. */
export function withReminderPause(
  metadata: Record<string, any> | null | undefined,
  pause: ReminderPause | null
): Record<string, any> {
  const next = { ...(metadata ?? {}) }
  if (pause) next.reminders_paused = pause
  else next.reminders_paused = null
  return next
}
