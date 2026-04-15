import { z } from "@medusajs/framework/zod"

export const AdminCreateEnergyRateReq = z.object({
  name: z.string(),
  energyType: z.enum([
    "energy_electricity",
    "energy_water",
    "energy_gas",
    "labor",
  ]),
  unitOfMeasure: z
    .enum(["kWh", "Liter", "Cubic_Meter", "Hour", "Other"])
    .optional(),
  ratePerUnit: z.number().positive(),
  currency: z.string().optional(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  region: z.string().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

export type AdminCreateEnergyRateReq = z.infer<typeof AdminCreateEnergyRateReq>

export const AdminUpdateEnergyRateReq = z.object({
  name: z.string().optional(),
  energyType: z
    .enum(["energy_electricity", "energy_water", "energy_gas", "labor"])
    .optional(),
  unitOfMeasure: z
    .enum(["kWh", "Liter", "Cubic_Meter", "Hour", "Other"])
    .optional(),
  ratePerUnit: z.number().positive().optional(),
  currency: z.string().optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
  region: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  metadata: z.record(z.any()).optional(),
})

export type AdminUpdateEnergyRateReq = z.infer<typeof AdminUpdateEnergyRateReq>
