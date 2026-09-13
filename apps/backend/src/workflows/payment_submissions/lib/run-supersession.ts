import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Is a completed run's work already represented by a different run?
 *
 * ## Why this exists (#2026)
 *
 * When a run is approved and split, `dualWriteChildRunOrdersStep` projects each
 * CHILD run to its own unified order and cancels the PARENT's order, stamping
 * `metadata.superseded_by_run_ids` on it. The commercial reality moves to the
 * children; the parent is bookkeeping.
 *
 * Nothing told the money side. `payable-runs` filters on
 * `{ partner_id, status: "completed" }` — and a superseded parent is still
 * `completed`, still carries the partner, still carries
 * `partner_cost_estimate`. It came back `payable: true` with no warning
 * alongside its own child, offering the same garment twice.
 *
 * That is not hypothetical. Sharlho's tweed jacket
 * (design `01M09V81MT94NSSZBJCQF79EXR`) drew THREE ₹1,200 payouts for TWO
 * garments: the August Medium run, the September Small child run, and the
 * September Small PARENT — whose order `order_01M25MSMWD5YRDM4BMXESZJTEM` was
 * canceled 15 seconds after creation carrying
 * `superseded_by_run_ids: ["prod_run_01M25MT34Y8X8ASZMX3X2X9KY7"]`. The screen
 * had the evidence one link away and never looked.
 *
 * ## The signal lives on the ORDER, not the run
 *
 * A superseded run carries no marker of its own: `status` stays `completed` and
 * `cancelled_at` stays null. The only record is its unified mirror order. So
 * this reads the run→order link — the same forward link
 * `resolveUnifiedOrderIdByLink` treats as authoritative — and not `run.order_id`,
 * which is the COMMISSIONING customer order and a different id entirely.
 *
 * ## Reported, never silently dropped
 *
 * The caller puts these in `excluded_runs` with their reason, per this
 * endpoint's standing rule: a screen that simply omits the row teaches nobody
 * why the work vanished. A partner may well have made those goods — just not in
 * that run — and whether a superseded run has any payout path is a question for
 * a human, not a filter.
 */

export type SupersessionReason = "superseded_run" | "canceled_mirror_order"

export type Supersession = {
  reason: SupersessionReason
  /** The runs that carry the work instead. Empty for a bare cancellation. */
  superseded_by_run_ids: string[]
  mirror_order_id: string | null
}

/** A mirror order as this module needs to see it. */
export type MirrorOrderForSupersession = {
  id?: string | null
  status?: string | null
  metadata?: Record<string, any> | null
} | null | undefined

/**
 * PURE: does this mirror order say the run's work moved elsewhere?
 *
 * `undefined` means "no, bill it normally". Note what does NOT qualify:
 *
 * - **No mirror order at all.** A missing link is a claim about our data, not
 *   about the work. Absence of evidence is not evidence — the run bills.
 * - **A live order carrying `superseded_by_run_ids`.** The key is written in the
 *   same call that cancels; a non-canceled order holding it is a half-applied
 *   write, and guessing at a partner's money from a half-written row is worse
 *   than billing it and letting a human see both rows.
 */
export function readSupersession(
  order: MirrorOrderForSupersession
): Supersession | undefined {
  if (!order) return undefined
  if (String(order.status ?? "").toLowerCase() !== "canceled") return undefined

  const raw = order.metadata?.superseded_by_run_ids
  const ids = Array.isArray(raw) ? raw.map(String).filter(Boolean) : []

  return {
    reason: ids.length ? "superseded_run" : "canceled_mirror_order",
    superseded_by_run_ids: ids,
    mirror_order_id: order.id ? String(order.id) : null,
  }
}

/**
 * Resolve supersession for many runs in ONE query, keyed by run id.
 *
 * Runs with no entry are payable as before. A query failure returns an EMPTY
 * map rather than throwing: this guard exists to stop an overpayment, and
 * taking the whole payables screen down because a link read hiccuped would turn
 * a money-safety check into an outage. The rows then behave exactly as they did
 * before this file existed.
 */
export async function fetchRunSupersessions(
  container: MedusaContainer,
  runIds: string[]
): Promise<Map<string, Supersession>> {
  const out = new Map<string, Supersession>()
  if (!runIds.length) return out

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "production_runs",
      // `order` is the LINKED unified mirror order — not the `order_id` column,
      // which points at the commissioning customer order (see the admin
      // registry's order_id vs work_order_id warning).
      fields: ["id", "order.id", "order.status", "order.metadata"],
      filters: { id: runIds },
    })

    for (const row of (data || []) as any[]) {
      const verdict = readSupersession(row?.order)
      if (verdict && row?.id) out.set(String(row.id), verdict)
    }
  } catch {
    return new Map()
  }

  return out
}
