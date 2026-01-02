import { z } from "zod"

const ProductionAssignmentSchema = z.object({
  partner_id: z.string().min(1),
  role: z.string().optional(),
  quantity: z.number().positive(),
})

export const AdminCreateDesignProductionRunSchema = z.object({
  quantity: z.number().positive().optional(),
  assignments: z.array(ProductionAssignmentSchema).min(1).optional(),
})

export type AdminCreateDesignProductionRunReq = z.infer<
  typeof AdminCreateDesignProductionRunSchema
>
