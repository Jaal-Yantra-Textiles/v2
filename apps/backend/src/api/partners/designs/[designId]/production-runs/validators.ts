import { z } from "@medusajs/framework/zod"

// Roadmap #6 Phase 4 — a partner creates a self-approved production
// run for their OWN design. execution_mode records whether the partner
// makes it themselves (in_house) or farms it out to a sub-partner
// (outsourced); sub_partner_id is required for the latter.
export const PartnerCreateProductionRunReq = z
  .object({
    quantity: z.number().positive().optional(),
    run_type: z.enum(["production", "sample"]).optional(),
    execution_mode: z.enum(["in_house", "outsourced"]).default("in_house"),
    sub_partner_id: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine(
    (b) => b.execution_mode !== "outsourced" || !!b.sub_partner_id,
    { message: "sub_partner_id is required when execution_mode is outsourced." }
  )
  .refine(
    (b) => b.execution_mode === "outsourced" || !b.sub_partner_id,
    { message: "sub_partner_id is only valid when execution_mode is outsourced." }
  )

export type PartnerCreateProductionRunReq = z.infer<
  typeof PartnerCreateProductionRunReq
>
