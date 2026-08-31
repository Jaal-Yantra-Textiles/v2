import { z } from "@medusajs/framework/zod"

export const AdminPostConsumptionLogReq = z.object({
  inventoryItemId: z.string(),
  rawMaterialId: z.string().optional(),
  productionRunId: z.string().optional(),
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

export type AdminPostConsumptionLogReq = z.infer<typeof AdminPostConsumptionLogReq>

export const AdminPostCommitConsumptionReq = z.object({
  logIds: z.array(z.string()).optional(),
  commitAll: z.boolean().optional(),
  defaultLocationId: z.string().optional(),
})

export type AdminPostCommitConsumptionReq = z.infer<typeof AdminPostCommitConsumptionReq>

/**
 * Correcting an existing log (PATCH). Every field optional — the route refuses
 * an empty body rather than silently no-opping.
 *
 * 🔴 `quantity_basis` is the reason this exists. The same `quantity` deducts
 * `q` under "total" and `q × pieces` under "per_piece", so a log recorded with
 * the wrong basis is not slightly wrong, it is wrong by a multiple. On the
 * design that prompted this, two `per_piece` logs would have deducted 12 m
 * where 6 m was used.
 *
 * `quantity` is `.positive()` for the same reason the create schema is: a 0
 * consumption is not a correction, it is a deletion wearing a disguise — and
 * DELETE exists for that, with its own audit line.
 */
export const AdminPatchConsumptionLogReq = z.object({
  quantity: z.number().positive().optional(),
  quantity_basis: z.enum(["total", "per_piece"]).nullish(),
  unit_cost: z.number().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
  location_id: z.string().trim().min(1).nullish(),
})

export type AdminPatchConsumptionLogReq = z.infer<
  typeof AdminPatchConsumptionLogReq
>
