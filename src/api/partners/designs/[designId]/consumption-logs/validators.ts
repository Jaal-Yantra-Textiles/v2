import { z } from "@medusajs/framework/zod"

export const PartnerPostConsumptionLogReq = z.object({
  inventoryItemId: z.string(),
  rawMaterialId: z.string().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().positive().optional(),
  unitOfMeasure: z
    .enum(["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"])
    .optional(),
  consumptionType: z.enum(["sample", "production", "wastage"]).optional(),
  notes: z.string().optional(),
  locationId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export type PartnerPostConsumptionLogReq = z.infer<typeof PartnerPostConsumptionLogReq>
