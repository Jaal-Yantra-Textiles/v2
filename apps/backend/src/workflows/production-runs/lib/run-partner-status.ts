/**
 * §5 partner-facing work-progress vocabulary, derived from a production run.
 *
 * A pure module so the mapping can be unit-tested without booting a container.
 * It had no coverage at all when #1574 was found.
 */

// §5 — the shared assigned→accepted→in_progress→finished→completed
// vocabulary. The legacy run enum collapses accepted/started/finished into
// one "in_progress" value; the lifecycle timestamps disambiguate. approved/
// draft/pending_review are absent on purpose (no partner work yet).
//
// 🔴 A cancelled run says "cancelled" unless the PARTNER declined it, in which
// case it says "declined". It used to return `undefined` for an admin cancel —
// "§5 defines no value for it" — and the mirror writes only truthy values, so
// `partner_status` was never cleared: it kept `accepted` / `in_progress` /
// `finished` and the order went on rendering as live work indefinitely.
// `undefined` meant "don't write" where it needed to mean "say it stopped".
// Same shape as #1565, where one NULL meant three different things. #1574
export const deriveRunPartnerStatus = (
  run: any,
  opts: { declined?: boolean } = {}
): string | undefined => {
  switch (run.status) {
    case "sent_to_partner":
      return "assigned"
    case "in_progress":
      if (run.finished_at) return "finished"
      if (run.started_at) return "in_progress"
      if (run.accepted_at) return "accepted"
      // Partner self-serve runs are born in_progress with no lifecycle
      // timestamps — the partner is already working on it.
      return "in_progress"
    case "completed":
      return "completed"
    case "cancelled":
      return opts.declined ? "declined" : "cancelled"
    default:
      return undefined
  }
}

const PARTNER_STATUS_ORDER = [
  "assigned",
  "accepted",
  "in_progress",
  "finished",
  "completed",
]

/**
 * The least-advanced partner status across a collated order's runs.
 *
 * 🔴 A cancelled run must not drag a live order backwards, and it must not be
 * invisible either. It is excluded from the progress ordering — one cancelled
 * run alongside four in flight leaves the order reading `in_progress` — and
 * the order only reads `cancelled` when EVERY run is.
 *
 * That last test asks `run.status` directly rather than counting the derived
 * values. `deriveRunPartnerStatus` returns `undefined` for draft / approved /
 * pending_review too, so a `.filter(Boolean)` that came up empty could mean
 * "all cancelled" OR "none dispatched yet" — and calling the second one
 * cancelled would retire an order nobody has started. #1574
 */
export const aggregatePartnerStatus = (runs: any[]): string | undefined => {
  if (!runs.length) return undefined

  if (runs.every((r) => String(r?.status) === "cancelled")) {
    return "cancelled"
  }

  const perRun = runs
    .map((r) => deriveRunPartnerStatus(r))
    .filter((s): s is string => Boolean(s))
    .filter((s) => s !== "cancelled" && s !== "declined")
  if (!perRun.length) return undefined
  let minIdx = PARTNER_STATUS_ORDER.length - 1
  for (const s of perRun) {
    const idx = PARTNER_STATUS_ORDER.indexOf(s)
    if (idx >= 0 && idx < minIdx) minIdx = idx
  }
  return PARTNER_STATUS_ORDER[minIdx]
}
