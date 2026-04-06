import { z } from "@medusajs/framework/zod"

const RecreateDesignEntrySchema = z.object({
  design_id: z.string().min(1),
  quantity: z.number().positive(),
  notes: z.string().optional(),
})

export const AdminRecreateProductionRunSchema = z.object({
  designs: z.array(RecreateDesignEntrySchema).min(1),
  partner_id: z.string().min(1),
  run_type: z.enum(["production", "sample"]).optional(),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export type AdminRecreateProductionRunReq = z.infer<
  typeof AdminRecreateProductionRunSchema
>
