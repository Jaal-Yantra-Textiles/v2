import { z } from "@medusajs/framework/zod"

/**
 * Mirrors `RunMaterialSchema` in production-runs/validators.ts, because it is
 * the same thing arriving by a different door: this route hands `assignments`
 * to `approveProductionRunWorkflow` verbatim, and that workflow has understood
 * `materials` since #1361.
 *
 * 🔴 It had to be DECLARED to arrive. The validator is strict, so an
 * undeclared `materials` is not passed through and not ignored — it is a 400
 * the operator cannot act on. That is the same defect the `template_names`
 * note below records: the handler was already right, the schema was the wall.
 */
const RunMaterialSchema = z.object({
  inventory_item_id: z.string().trim().min(1),
  planned_quantity: z.number().positive().nullish(),
  location_id: z.string().trim().min(1).nullish(),
  resolved_raw_material_id: z.string().trim().min(1).nullish(),
  note: z.string().nullish(),
  metadata: z.record(z.string(), z.any()).nullish(),
})

const ProductionAssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  /**
   * Units for this child run. `null` declares it OPEN-ENDED — no agreed
   * quantity, and so no ceiling on what may be billed against it (#1676).
   * A number is still required otherwise: "allocate nothing" is not a share.
   */
  quantity: z.number().positive().nullable(),
  order: z.number().int().positive().optional(),
  /**
   * Which of the design's inventory items THIS partner is sent, and how much.
   * Omit (or send an empty array) and the assignment is unconstrained — the
   * child run carries the whole BOM, exactly as before this field existed.
   */
  materials: z.array(RunMaterialSchema).nullish(),
  // See production-runs/validators.ts for the rationale. The admin UI's
  // "Send to production" toggle sends `template_names: null` when no
  // templates are picked — `.optional()` alone rejected that with
  // "Field is required" and never let the request reach the workflow.
  template_names: z.array(z.string()).nullish(),
  /** #1268 — the preferred, unambiguous form. See production-runs/validators.ts. */
  template_ids: z.array(z.string()).nullish(),
})

export const AdminCreateDesignProductionRunSchema = z.object({
  /**
   * The agreed quantity for the parent run. Omit it and it is inferred from the
   * assignments (or defaults to 1).
   *
   * 🔴 `null` is NOT the same as omitting it (#1676): it declares that this run
   * has no agreed amount — open-ended, ongoing work — which opts it out of the
   * payment ceiling entirely.
   */
  quantity: z.number().positive().nullish(),
  run_type: z.enum(["production", "sample"]).optional(),
  assignments: z.array(ProductionAssignmentSchema).min(1).optional(),
  /**
   * The template selection to give assignments this route builds ITSELF, when
   * the caller sent none and the design's linked partners are used instead.
   *
   * The route has always read `body.template_names` for that branch, but the
   * schema never declared it, so zod stripped it before the handler ever saw
   * it — the auto-populated assignments got `[]` every time and those runs were
   * created approved and then never dispatched. Declaring the fields is the
   * whole fix; the branch already does the right thing with them.
   *
   * Ignored when `assignments` are given — those carry their own selection.
   * Ids preferred, for the reasons in production-runs/validators.ts.
   */
  template_ids: z.array(z.string()).nullish(),
  template_names: z.array(z.string()).nullish(),
})

export type AdminCreateDesignProductionRunReq = z.infer<
  typeof AdminCreateDesignProductionRunSchema
>
