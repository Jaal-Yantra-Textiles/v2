/**
 * @file PURE: is this design work the partner is expected to DO, or was it
 * merely shared with them?
 *
 * A design reaches the partner dashboard as soon as a `design_partners_link`
 * row exists — an admin linking a design is enough. Nothing on the listing ever
 * said whether that link was followed by actual work, so a design an admin
 * linked for reference and a design the partner is on the hook for looked
 * identical. On production, partner Sharlho has 34 linked designs and 18 of
 * them have no run for the partner at all.
 *
 * Production runs are the assignment record (see `buildPartnerDesignView` — the
 * whole `partner_status` lifecycle is derived from them), so "assigned" means:
 * this partner has at least one production run on this design.
 *
 * Kept pure and dependency-free so the rule is unit-testable without booting
 * Medusa. Do NOT re-derive this anywhere else — one rule, one home.
 */

/** The three states, which must never be collapsed into two. */
export type PartnerDesignEngagement = "owned" | "assigned" | "shared"

export type PartnerEngagementInfo = {
  /**
   * `owned`    — the partner created this design (`owner_partner_id` is them).
   *              Reported even when they also have a run on it; `has_partner_run`
   *              carries that second fact rather than overwriting this one.
   * `assigned` — not theirs, but they hold a production run on it: real work.
   * `shared`   — linked only. Visible, but nobody asked them to do anything.
   */
  engagement: PartnerDesignEngagement
  /** True iff at least one run on this design belongs to THIS partner. */
  has_partner_run: boolean
  /** How many of this design's runs are this partner's (0 for `shared`). */
  partner_run_count: number
}

type RunLike = {
  design_id?: string | null
  partner_id?: string | null
  /** Read only for documentation/debugging; ownership is decided by partner_id. */
  execution_mode?: string | null
  sub_partner_id?: string | null
  [key: string]: unknown
}

/**
 * PURE: does this run belong to `partnerId`?
 *
 * Strictly `run.partner_id === partnerId`. Two cases this deliberately excludes:
 *
 *  1. `partner_id: null` + `execution_mode: "in_house"` — the work was pulled
 *     in-house. The design usually stays linked to the partner, so the link row
 *     survives, but the run is not theirs and must not read as assigned.
 *     (Prod: `Lhamho Jacket` / 01K5RGXG0WZN3W47A1HCTW5HR6 on Sharlho.)
 *  2. A run whose `partner_id` is a DIFFERENT partner.
 *
 * `sub_partner_id` — an outsourced run handed down to another partner — does
 * NOT count either, deliberately:
 *   - The listing only ever fetches runs filtered by `partner_id` (see
 *     `resolvePartnerDesignRunsStep`), so a sub-partner run never reaches this
 *     function in production; honouring it here would be an unexercised rule.
 *   - Every other partner-facing derivation on this design (`partner_status`,
 *     the work buckets, the accept/start/finish transitions) keys on
 *     `partner_id`. Badging a sub-partner design "Assigned" while its Work
 *     Status stayed "incoming" and its action buttons stayed inert would be a
 *     worse lie than the one being fixed.
 * If sub-partner assignment should surface, it needs its own fetch and its own
 * lifecycle — not a quiet widening of this predicate.
 */
export function isRunOwnedByPartner(run: RunLike | null | undefined, partnerId: string): boolean {
  if (!run || !partnerId) {
    return false
  }
  // `undefined` is NOT `null` here, and the difference matters. `null` is the
  // database saying "this run has no partner" (the in-house case) — not theirs.
  // `undefined` is the KEY BEING ABSENT, i.e. the caller never selected
  // `partner_id`; every caller in this file reads runs already filtered by
  // `partner_id`, so the run is theirs and treating an unselected column as a
  // disqualification would silently mark every design "shared".
  if (!("partner_id" in run) || run.partner_id === undefined) {
    return true
  }
  // `!= null` and not a truthiness check: an empty-string partner_id is not an
  // assignment either, and String(null) === "null" would sail through ===.
  return run.partner_id != null && String(run.partner_id) === String(partnerId)
}

/**
 * PURE: the runs on `designId` that belong to `partnerId`.
 */
export function partnerRunsForDesign(
  runs: readonly RunLike[] | null | undefined,
  designId: string,
  partnerId: string
): RunLike[] {
  if (!designId) {
    return []
  }
  return (runs || []).filter(
    (run) =>
      run != null &&
      run.design_id != null &&
      String(run.design_id) === String(designId) &&
      isRunOwnedByPartner(run, partnerId)
  )
}

/**
 * PURE: the engagement of one design for one partner.
 *
 * Precedence: ownership first. A design the partner created is "theirs" even
 * before any run exists — calling it "shared with you" would be nonsense. The
 * run fact is not lost: `has_partner_run` is reported independently, so an
 * owned design with a run reads as owned AND assigned.
 */
export function derivePartnerEngagement(
  design: { id?: string | null; owner_partner_id?: string | null } | null | undefined,
  partnerId: string,
  runs: readonly RunLike[] | null | undefined
): PartnerEngagementInfo {
  const designId = design?.id != null ? String(design.id) : ""
  const mine = partnerRunsForDesign(runs, designId, partnerId)

  const isOwner =
    design?.owner_partner_id != null &&
    String(design.owner_partner_id) === String(partnerId)

  return {
    engagement: isOwner ? "owned" : mine.length > 0 ? "assigned" : "shared",
    has_partner_run: mine.length > 0,
    partner_run_count: mine.length,
  }
}
