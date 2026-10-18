import { z } from "@medusajs/framework/zod"

/**
 * Partner lists hide cancelled work unless the partner asks for it.
 *
 * Founder decision 2026-10-18: a partner's lists of production runs, designs
 * and work orders read as "what is on my plate". Cancelled rows are history,
 * and a re-dispatched run left a cancelled twin of the same work in the list.
 * So the default excludes them, and they come back only when asked for
 * EXPLICITLY: `include_cancelled=true`, or a `status` filter naming them.
 *
 * The exclusion is a query filter, not a post-filter, so `count` and
 * pagination stay right.
 */

/** Query-string flag. Only the literal "true" opts in. */
export const includeCancelledQueryParam = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true")

/**
 * The `status` filter a partner run list should send.
 * - An explicit `status` always wins (asking for "cancelled" shows cancelled).
 * - Otherwise cancelled runs are excluded unless `includeCancelled`.
 */
export const partnerRunStatusFilter = (
  status: string | undefined,
  includeCancelled: boolean | undefined
): string | { $ne: string } | undefined => {
  if (status) return status
  if (includeCancelled) return undefined
  return { $ne: "cancelled" }
}

/**
 * Same rule for work orders, whose order status spells it with ONE "l":
 * a cancelled run mirrors to an order `status: "canceled"`.
 */
export const partnerWorkOrderStatusFilter = (
  status: unknown,
  includeCancelled: boolean | undefined
): unknown => {
  if (status !== undefined && status !== null && status !== "") return status
  if (includeCancelled) return undefined
  return { $ne: "canceled" }
}
