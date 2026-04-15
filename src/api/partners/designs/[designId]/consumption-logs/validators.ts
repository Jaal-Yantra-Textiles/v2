import { z } from "@medusajs/framework/zod"

export const PartnerPostConsumptionLogReq = z.object({
  inventoryItemId: z.string(),
  rawMaterialId: z.string().optional(),
  productionRunId: z.string().optional(),
  quantity: z.number().positive(),
  unitCost: z.number().positive().optional(),
  unitOfMeasure: z
    .enum([
      "Meter",
      "Yard",
      "Kilogram",
      "Gram",
      "Piece",
      "Roll",
      "kWh",
      "Liter",
      "Cubic_Meter",
      "Hour",
      "Other",
    ])
    .optional(),
  consumptionType: z
    .enum([
      "sample",
      "production",
      "wastage",
      "energy_electricity",
      "energy_water",
      "energy_gas",
      "labor",
    ])
    .optional(),
  notes: z.string().optional(),
  locationId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export type PartnerPostConsumptionLogReq = z.infer<typeof PartnerPostConsumptionLogReq>
