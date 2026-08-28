import { z } from "@medusajs/framework/zod"

/**
 * Consumption captured against a RUN rather than a design.
 *
 * Deliberately the same field names as the design-scoped validator so the two
 * capture forms cannot drift; the difference is what anchors the log, and that
 * is resolved from the run itself rather than sent by the caller. A caller that
 * could name its own design_id/product_id could anchor a log to something the
 * run has nothing to do with.
 */
export const AdminPostRunConsumptionLogReq = z.object({
  inventoryItemId: z.string(),
  rawMaterialId: z.string().optional(),
  quantity: z.number().positive(),
  quantityBasis: z.enum(["total", "per_piece"]).optional(),
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
  metadata: z.record(z.string(), z.any()).optional(),
})

export type AdminPostRunConsumptionLogReq = z.infer<
  typeof AdminPostRunConsumptionLogReq
>

export const AdminPostRunCommitConsumptionReq = z.object({
  logIds: z.array(z.string()).optional(),
  commitAll: z.boolean().optional(),
})

export type AdminPostRunCommitConsumptionReq = z.infer<
  typeof AdminPostRunCommitConsumptionReq
>
