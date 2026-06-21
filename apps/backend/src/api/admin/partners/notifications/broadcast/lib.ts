/**
 * Pure helpers for the admin partner-broadcast notification route.
 *
 * Kept side-effect-free so the target-resolution and result-summary logic
 * can be unit-tested without booting Medusa or the notification module.
 */

export type PartnerLite = { id: string; status?: string | null }

export type BroadcastTargetInput = {
  /** Explicit partner ids. When present, only these (intersected with known partners) are targeted. */
  partner_ids?: string[]
  /** When no explicit ids are given, optionally restrict the all-partners fan-out by status. */
  status?: "active" | "inactive" | "pending"
}

/**
 * Resolve the final, de-duplicated list of partner ids to notify.
 *
 * - With explicit `partner_ids`: keep only ids that exist in `partners`
 *   (unknown ids are silently dropped so a stale id can't fabricate a row).
 * - Without explicit ids: take every partner, optionally filtered by `status`.
 *
 * Order is preserved (input order for explicit ids, list order otherwise).
 */
export function selectBroadcastPartnerIds(
  partners: PartnerLite[],
  input: BroadcastTargetInput
): string[] {
  const known = new Set(partners.map((p) => p.id))

  let ids: string[]
  if (input.partner_ids && input.partner_ids.length) {
    ids = input.partner_ids.filter((id) => known.has(id))
  } else {
    ids = partners
      .filter((p) => !input.status || p.status === input.status)
      .map((p) => p.id)
  }

  return Array.from(new Set(ids))
}

export type BroadcastResult = { partner_id: string; ok: boolean }

export type BroadcastSummary = {
  total: number
  sent: number
  failed: number
  /** partner ids whose notification row failed to create. */
  failures: string[]
}

/**
 * Summarize per-partner create results into counts + the list of failed ids.
 */
export function summarizeBroadcast(
  results: BroadcastResult[]
): BroadcastSummary {
  const failures = results.filter((r) => !r.ok).map((r) => r.partner_id)
  return {
    total: results.length,
    sent: results.length - failures.length,
    failed: failures.length,
    failures,
  }
}
