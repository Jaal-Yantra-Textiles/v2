/**
 * When does the model genuinely EXPECT a neighbour on a production run? (#2111 S2)
 *
 * Every rule below was measured against the **146 real runs on prod**
 * (2026-09-20) before it was written, and each comment carries the count it
 * fires on. A rule that has never met a real row is a guess with a test around
 * it — see `social-platform/absence.ts` for the four that were deferred rather
 * than shipped on a fixture's word.
 *
 * 🔴 One rule was DELIBERATELY NOT WRITTEN. `stocked_at_location_id` is null on
 * **146 of 146** runs — nothing produced on this platform has ever been banked
 * into stock. A rule firing on literally every row asserts nothing about the
 * run you are looking at; it is a statement about the platform, and it belongs
 * in #2053, not on a canvas where it would be the loudest thing on every graph
 * forever. The spine states the fact on the node and does not cry about it.
 */

export type RunLike = {
  id: string
  status?: string | null
  partner_id?: string | null
  order_line_item_id?: string | null
  produced_quantity?: number | null
  approved_product_id?: string | null
  reminder_status?: string | null
  parent_run_id?: string | null
}

/** Statuses where the work is still live — nothing is settled yet. */
const OPEN = new Set([
  "draft",
  "pending_review",
  "approved",
  "sent_to_partner",
  "in_progress",
  "awaiting_reassignment",
])

export const isOpen = (status?: string | null): boolean =>
  OPEN.has(String(status ?? ""))

/**
 * A run nobody ordered.
 *
 * 🔴 The consequence is not cosmetic: a run with no `order_line_item_id` is a
 * customer's via nothing at all, and fulfillment mints a PHANTOM DUPLICATE for
 * it — born `completed`, with no activity trail. That is the single most
 * expensive thing this graph can show.
 *
 * Measured: **124 of 146** runs carry no order line. So this is stated as a
 * plain `absent` edge with the consequence named, and NOT as a fault on the
 * run: a design-led stock run legitimately has no commissioning line, and
 * there is nothing on the row that distinguishes one from the other. The graph
 * says what is missing and what that costs; it does not accuse.
 */
export const isUncommissioned = (run: RunLike): boolean =>
  !run.order_line_item_id

/**
 * Finished, and nobody ever said how many were made.
 *
 * `produced_quantity` is what a payout is measured against (capped at
 * `ordered`), so a completed run with none is a settled job with an unstated
 * result. Measured: **25 of 77** completed runs.
 *
 * 🔴 `null`, not falsy. A genuine `0` — nothing usable came out — is a real,
 * different answer, and `!run.produced_quantity` would silently merge the two.
 */
export const completedWithoutOutput = (run: RunLike): boolean =>
  String(run.status) === "completed" &&
  (run.produced_quantity === null || run.produced_quantity === undefined)

/**
 * Finished, and no product was ever minted from it.
 *
 * Measured: **64 of 77** completed runs have no `approved_product_id`. The work
 * happened and nothing in the catalogue can be sold as its result — so the
 * run's output is invisible to every surface that sells.
 */
export const completedWithoutProduct = (run: RunLike): boolean =>
  String(run.status) === "completed" && !run.approved_product_id

/**
 * The partner was chased twice and has said nothing.
 *
 * Measured: **6 live runs** sit at `reminder_status: escalated`; one has been
 * `in_progress` for 9 days. This is `derived`, not `absent` — the partner
 * neighbour exists and is not answering, which is a different sentence from
 * "no partner is assigned" and has a different fix.
 */
export const partnerSilent = (run: RunLike): boolean =>
  isOpen(run.status) && String(run.reminder_status ?? "") === "escalated"

/**
 * Live work with nobody to do it.
 *
 * Measured: **14 of 20** live runs have no `partner_id`. On a parent/child pair
 * the parent frequently carries none while the child does — which is normal, so
 * a CHILDLESS open run is the one worth asserting on. The caller passes
 * `hasChildren` because that cannot be read off the row.
 */
export const openWithoutPartner = (
  run: RunLike,
  hasChildren: boolean
): boolean => isOpen(run.status) && !run.partner_id && !hasChildren

/**
 * An upstream inventory order that has not arrived.
 *
 * 🔴 `Delivered`, never `Shipped`. The gate that holds a run's dispatch is met
 * only at `Delivered`, and treating `Shipped` as met would release work to a
 * partner who does not have the cloth yet. Proven on prod by the S1 run
 * (`prod_run_01M2RV80NQJRKKHJE4S99FQ4QG`): of its two attached orders the
 * `Delivered` one was ABSENT from the refusal and the `Pending` one named in
 * it.
 */
export const isDependencyMet = (status?: string | null): boolean =>
  String(status ?? "").toLowerCase() === "delivered"
