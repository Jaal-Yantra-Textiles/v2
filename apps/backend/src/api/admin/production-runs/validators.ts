import { z } from "@medusajs/framework/zod"

/**
 * The materials an assignment is issued — a subset of the design's bill of
 * materials, not a free-form list. The workflow re-checks membership against
 * the design (the validator cannot see the BOM); this shape only guarantees the
 * fields it can. `planned_quantity` is `.positive()` because "allocate 0 of the
 * silk" would pass the consumption gate while promising nothing.
 */
const RunMaterialSchema = z.object({
  inventory_item_id: z.string().trim().min(1),
  planned_quantity: z.number().positive().nullish(),
  location_id: z.string().trim().min(1).nullish(),
  resolved_raw_material_id: z.string().trim().min(1).nullish(),
  note: z.string().nullish(),
  metadata: z.record(z.string(), z.any()).nullish(),
})

const AssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  /**
   * Units for this child run. Omit to inherit the parent's; `null` declares
   * this child OPEN-ENDED — no agreed quantity, and so no ceiling on what may
   * be billed against it (#1676).
   */
  quantity: z.number().nullish(),
  order: z.number().int().positive().optional(),
  // `.nullish()` (= optional + nullable) accepts undefined, null, or
  // an array. The admin UI sends `null` when the "Send to production"
  // toggle is on but no templates are picked — `.optional()` alone
  // rejected that with "Field is required" and never let the request
  // reach the workflow, so the run was never created and no WhatsApp
  // fired. With null/empty the auto-dispatch loop in the route handler
  // skips dispatch — the run lands in `approved`/idle.
  template_names: z.array(z.string()).nullish(),
  /**
   * #1268 — the same selection by id, and the preferred form. A name may match
   * two templates, and dispatch refuses such a name, so an approval that
   * recorded only names can become impossible to carry out. Same `.nullish()`
   * tolerance as the names, for the same reason.
   */
  template_ids: z.array(z.string()).nullish(),
  /**
   * Which of the design's inventory items THIS partner is sent, and how much.
   * Omit (or send an empty array) and the assignment is unconstrained — the
   * child run carries the whole BOM, exactly as before this field existed.
   */
  materials: z.array(RunMaterialSchema).nullish(),
  /**
   * #1529 — inventory orders whose goods this stage waits on. Lets a chain open
   * with a supplier rather than a maker: the stage stays undispatchable until
   * every one of them is `Delivered`, then releases itself. Same `.nullish()`
   * tolerance as the template fields, for the same reason — the admin UI sends
   * null for a toggle that is on with nothing picked.
   */
  depends_on_inventory_order_ids: z.array(z.string().min(1)).nullish(),
})

export const AdminCreateProductionRunReq = z.object({
  design_id: z.string().min(1),
  partner_id: z.string().optional(),
  /**
   * The agreed quantity. Omit it and the run is ordered for 1, as always.
   *
   * 🔴 `null` is NOT the same as omitting it (#1676): it declares that this run
   * has no agreed amount — open-ended, ongoing work — and that declaration opts
   * the run out of the payment ceiling, so nothing refuses a claim against it.
   * `.nullish()` rather than `.optional()` exists solely to let that be said.
   */
  quantity: z.number().nullish(),
  run_type: z.enum(["production", "sample"]).optional(),
  product_id: z.string().optional(),
  variant_id: z.string().optional(),
  order_id: z.string().optional(),
  order_line_item_id: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  materials: z.array(RunMaterialSchema).nullish(),
})

export const AdminApproveProductionRunReq = z.object({
  assignments: z.array(AssignmentSchema).optional(),
})

/**
 * #1261 — a selection may be made by id or by name.
 *
 * Ids are preferred and win when both are sent: a name does not identify a
 * template (prod's two "Stitching" rows differ only by category), and dispatch
 * now REFUSES an ambiguous name rather than picking one. `template_names` stays
 * because most names are unambiguous and every existing caller uses them.
 */
const templateSelection = {
  template_names: z.array(z.string().min(1)).min(1).optional(),
  template_ids: z.array(z.string().min(1)).min(1).optional(),
}

const requireOneSelection = (data: {
  template_names?: string[]
  template_ids?: string[]
}) => Boolean(data.template_ids?.length || data.template_names?.length)

const selectionRequired = {
  message: "Pass template_ids (preferred) or template_names.",
  path: ["template_ids"],
}

export const AdminSendProductionRunToProductionReq = z
  .object(templateSelection)
  .refine(requireOneSelection, selectionRequired)

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

export const AdminResumeDispatchProductionRunReq = z
  .object({
    ...templateSelection,
    transaction_id: z.string().min(1),
  })
  .refine(requireOneSelection, selectionRequired)

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
   * The same override, BY ID — the only way to name one of two same-named
   * templates. Wins over `template_names` when both are sent.
   */
  template_ids: z.array(z.string().min(1)).optional(),
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

export const AdminFinishProductionRunReq = z.object({
  notes: z.string().max(1000).nullish(),
})

/**
 * Reviewing what completed runs produced, in bulk (#1805).
 *
 * 🔴 A rejection MUST carry a reason. "Rejected" with nothing beside it is the
 * same dead end as no state at all, one step later: the next person meets a run
 * that was refused and cannot learn why, and the partner who made the goods
 * cannot be told. An approval needs no reason — the product it created is the
 * record.
 *
 * `run_ids` is bounded. A selection is something a person made on a screen; an
 * unbounded list is how a mis-built client asks to decide the entire platform's
 * production history in one call.
 */
export const AdminRunApprovalsReq = z
  .object({
    run_ids: z.array(z.string().trim().min(1)).min(1).max(200),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(1000).nullish(),
    /**
     * Resolve which runs map to which designs, which designs already have a
     * product, and what each decision WOULD create — and create nothing. Same
     * reason the collate wizard has one (#1803): the operator sees the shape of
     * the batch before it happens.
     */
    dry_run: z.boolean().optional(),
  })
  .refine(
    // A PREVIEW is not a decision, so it does not need the reason a decision
    // does — an operator asks what a rejection would cover before writing the
    // sentence that explains it.
    (b) =>
      b.dry_run === true ||
      b.decision !== "reject" ||
      Boolean(b.reason && b.reason.trim()),
    {
      message:
        "A rejection needs a reason — it is the only record of why the output was refused, and the partner who made the goods has to be able to be told.",
      path: ["reason"],
    }
  )

export type AdminCreateProductionRunReq = z.infer<typeof AdminCreateProductionRunReq>
export type AdminApproveProductionRunReq = z.infer<typeof AdminApproveProductionRunReq>
export type AdminSendProductionRunToProductionReq = z.infer<typeof AdminSendProductionRunToProductionReq>
export type AdminStartDispatchProductionRunReq = z.infer<typeof AdminStartDispatchProductionRunReq>
export type AdminResumeDispatchProductionRunReq = z.infer<typeof AdminResumeDispatchProductionRunReq>
export type AdminAssignProductionRunPartnerReq = z.infer<typeof AdminAssignProductionRunPartnerReq>
export type AdminRedispatchParkedRunsReq = z.infer<typeof AdminRedispatchParkedRunsReq>
export type AdminFinishProductionRunReq = z.infer<typeof AdminFinishProductionRunReq>
export type AdminRunApprovalsReq = z.infer<typeof AdminRunApprovalsReq>
