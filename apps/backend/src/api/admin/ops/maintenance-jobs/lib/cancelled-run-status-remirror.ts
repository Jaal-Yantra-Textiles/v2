import {
  aggregatePartnerStatus,
  deriveRunPartnerStatus,
} from "../../../../../workflows/production-runs/lib/run-partner-status"

/**
 * #1574 — which cancelled runs are still telling their order they are live.
 *
 * ## Why a repair job exists at all
 *
 * `mirrorRunStatusToUnifiedOrder` fires on a status CHANGE. #1577 fixed the
 * derivation so that a cancel now writes `partner_status = "cancelled"` — but
 * it fixed the FUTURE. Every run cancelled before that deploy transitioned
 * while the derivation returned `undefined`, the mirror writes only truthy
 * values, and so the sidecar kept whatever it last said: `assigned`,
 * `accepted`, `in_progress`, `finished`. Those orders still render as work in
 * progress and no later event will ever revisit them — nothing changes status
 * on a run that is already terminal.
 *
 * ## Why it has to REPORT rather than repair quietly
 *
 * 🔴 `mirrorRunStatusToUnifiedOrder` catches everything and logs a warning:
 *
 *     catch (e) { logger.warn(...); return { linked: false, error } }
 *
 * That is why an admin cancel could return **200** while its status write was
 * rejected by the database. A repair built on the same call would inherit the
 * same blindness — it would report "40 repaired" whether or not a single row
 * changed. So the job re-READS the sidecar afterwards and reports the value it
 * actually finds, and a row that did not move is an ERROR, not a warning.
 *
 * ## Expectations are computed with the mirror's OWN helpers
 *
 * 🔑 `expectedPartnerStatusFor` calls `aggregatePartnerStatus` /
 * `deriveRunPartnerStatus` — the same functions the mirror uses — rather than
 * re-deriving "cancelled runs should say cancelled". A second implementation
 * of that rule is how the two drift apart, and the drift is the bug this job
 * exists to repair.
 */

export type LinkedRunSnapshot = {
  id: string
  status?: string | null
  accepted_at?: string | Date | null
  started_at?: string | Date | null
  finished_at?: string | Date | null
}

export type MirrorCandidate = {
  run_id: string
  run: LinkedRunSnapshot
  unified_order_id?: string | null
  /** A parent order superseded by a run split stays canceled on purpose. */
  superseded?: boolean
  current_partner_status?: string | null
  /** Every run linked to the same order — a collated work-order has many. */
  linked_runs: LinkedRunSnapshot[]
}

export type RemirrorVerdict =
  | "stale"
  | "already_correct"
  | "no_unified_order"
  | "superseded"
  | "undeterminable"

export type RemirrorDecision = {
  run_id: string
  unified_order_id?: string
  verdict: RemirrorVerdict
  expected_partner_status?: string
  current_partner_status?: string
  /** Why, in the operator's terms — a dry-run nobody can argue with is no use. */
  note: string
}

/**
 * What the mirror WOULD write for this order, by the mirror's own rules.
 *
 * A collated order (N runs → 1 order) rolls up across every run, so a single
 * cancelled run among four in flight correctly leaves the order reading
 * `in_progress`. Predicting "cancelled" for those would make the job report
 * healthy orders as broken and then "repair" them into a lie.
 */
export const expectedPartnerStatusFor = (
  candidate: MirrorCandidate
): string | undefined =>
  candidate.linked_runs.length > 1
    ? aggregatePartnerStatus(candidate.linked_runs)
    : deriveRunPartnerStatus(candidate.run)

export const decideRunStatusRemirrors = (
  candidates: MirrorCandidate[]
): RemirrorDecision[] =>
  (candidates || []).map((c) => {
    const current = c.current_partner_status ?? null

    if (!c.unified_order_id) {
      return {
        run_id: c.run_id,
        verdict: "no_unified_order" as const,
        note: "no unified order is linked to this run — nothing to mirror onto",
      }
    }
    if (c.superseded) {
      return {
        run_id: c.run_id,
        unified_order_id: c.unified_order_id,
        verdict: "superseded" as const,
        current_partner_status: current ?? undefined,
        note: "order superseded by a run split — the child orders carry the commercial reality",
      }
    }

    const expected = expectedPartnerStatusFor(c)

    if (!expected) {
      // 🔑 NOT "already_correct". The mirror writes only truthy values, so it
      // would leave this row exactly as it is — which means the job cannot say
      // the row is right, only that it cannot judge it. Reporting that as
      // healthy is how the original bug hid.
      return {
        run_id: c.run_id,
        unified_order_id: c.unified_order_id,
        verdict: "undeterminable" as const,
        current_partner_status: current ?? undefined,
        note: `no partner_status is derivable from run status "${c.run.status}" — the mirror would write nothing`,
      }
    }

    if (current === expected) {
      return {
        run_id: c.run_id,
        unified_order_id: c.unified_order_id,
        verdict: "already_correct" as const,
        expected_partner_status: expected,
        current_partner_status: current,
        note: `already "${expected}"`,
      }
    }

    return {
      run_id: c.run_id,
      unified_order_id: c.unified_order_id,
      verdict: "stale" as const,
      expected_partner_status: expected,
      current_partner_status: current ?? undefined,
      note:
        c.linked_runs.length > 1
          ? `collated order of ${c.linked_runs.length} runs: says "${current ?? "(unset)"}", rolls up to "${expected}"`
          : `says "${current ?? "(unset)"}", should say "${expected}"`,
    }
  })

/** Counts per verdict, so a summary never implies the buckets it omitted. */
export const summarizeRemirrorDecisions = (
  decisions: RemirrorDecision[]
): Record<RemirrorVerdict, number> => {
  const out: Record<RemirrorVerdict, number> = {
    stale: 0,
    already_correct: 0,
    no_unified_order: 0,
    superseded: 0,
    undeterminable: 0,
  }
  for (const d of decisions) out[d.verdict]++
  return out
}
