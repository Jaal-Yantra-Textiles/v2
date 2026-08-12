import { z } from "@medusajs/framework/zod"

const AssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().optional(),
  order: z.number().int().positive().optional(),
  // `.nullish()` (= optional + nullable) accepts undefined, null, or
  // an array. The admin UI sends `null` when the "Send to production"
  // toggle is on but no templates are picked — `.optional()` alone
  // rejected that with "Field is required" and never let the request
  // reach the workflow, so the run was never created and no WhatsApp
  // fired. With null/empty the auto-dispatch loop in the route handler
  // skips dispatch — the run lands in `approved`/idle.
  template_names: z.array(z.string()).nullish(),
})

export const AdminCreateProductionRunReq = z.object({
  design_id: z.string().min(1),
  partner_id: z.string().optional(),
  quantity: z.number().optional(),
  run_type: z.enum(["production", "sample"]).optional(),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  order_id: z.string().optional(),
  order_line_item_id: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export const AdminApproveProductionRunReq = z.object({
  assignments: z.array(AssignmentSchema).optional(),
})

export const AdminSendProductionRunToProductionReq = z.object({
  template_names: z.array(z.string()).min(1),
})

export const AdminStartDispatchProductionRunReq = z.object({})

export const AdminCancelProductionRunReq = z.object({
  reason: z.string().optional(),
})

/**
 * #1228 — manual (re)assignment. `partner_id` may be the partner who already
 * let the run go stale (the "send to the same partner again" case) or a new
 * one; the route treats both identically.
 */
export const AdminAssignProductionRunPartnerReq = z.object({
  partner_id: z.string().min(1),
  note: z.string().max(500).nullish(),
})

export const AdminResumeDispatchProductionRunReq = z.object({
  template_names: z.array(z.string()).min(1),
  transaction_id: z.string().min(1),
})

/**
 * Re-send parked runs to the partner they came from.
 *
 * `partner_id` FILTERS which parked runs are considered — it is never the
 * partner assigned. Each run goes back to its own `previous_partner_id`, so
 * this endpoint cannot hand one partner's work to another.
 */
export const AdminRedispatchParkedRunsReq = z.object({
  partner_id: z.string().min(1).nullish(),
  /**
   * Templates to dispatch every selected run with. Overrides recovered history,
   * so it applies ONE set to runs that may not have used the same one — the
   * dry-run says so when they disagree.
   */
  template_names: z.array(z.string()).optional(),
  /**
   * Dispatch each run with the templates IT went out with last time, recovered
   * from its own tasks. Per run, so a batch whose runs used different sets goes
   * back out correctly — which on prod is every batch.
   */
  use_previous_templates: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  note: z.string().max(500).nullish(),
  /** Defaults true — previewing costs nothing, dispatching messages partners. */
  dry_run: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

export type AdminCreateProductionRunReq = z.infer<typeof AdminCreateProductionRunReq>
export type AdminApproveProductionRunReq = z.infer<typeof AdminApproveProductionRunReq>
export type AdminSendProductionRunToProductionReq = z.infer<typeof AdminSendProductionRunToProductionReq>
export type AdminStartDispatchProductionRunReq = z.infer<typeof AdminStartDispatchProductionRunReq>
export type AdminResumeDispatchProductionRunReq = z.infer<typeof AdminResumeDispatchProductionRunReq>
export type AdminAssignProductionRunPartnerReq = z.infer<typeof AdminAssignProductionRunPartnerReq>
export type AdminRedispatchParkedRunsReq = z.infer<typeof AdminRedispatchParkedRunsReq>
