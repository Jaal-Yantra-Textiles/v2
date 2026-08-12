import { z } from "@medusajs/framework/zod"

const ProductionAssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().positive(),
  order: z.number().int().positive().optional(),
  // See production-runs/validators.ts for the rationale. The admin UI's
  // "Send to production" toggle sends `template_names: null` when no
  // templates are picked — `.optional()` alone rejected that with
  // "Field is required" and never let the request reach the workflow.
  template_names: z.array(z.string()).nullish(),
  /** #1268 — the preferred, unambiguous form. See production-runs/validators.ts. */
  template_ids: z.array(z.string()).nullish(),
})

export const AdminCreateDesignProductionRunSchema = z.object({
  quantity: z.number().positive().optional(),
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
