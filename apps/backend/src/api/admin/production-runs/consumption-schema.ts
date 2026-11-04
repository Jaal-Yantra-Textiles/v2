import { z } from "@medusajs/framework/zod"

/**
 * The material a run used, as a completion sends it — one line per material.
 *
 * Shared by the partner and admin completion doors for the same reason as
 * `output-schema.ts`: a strict validator STRIPS an undeclared field, and the
 * admin door never declared `consumptions`, so an admin closing a run had no
 * way to say what it used — the material had to be logged and committed by
 * hand afterwards (prod 2026-11-04, Prince's denim run).
 */
export const CompletionConsumptionsSchema = z.array(
  z.object({
    inventory_item_id: z.string().optional(),
    quantity: z.number().positive(),
    /**
     * What `quantity` measures: what this run used in all ("total") or one
     * piece's worth ("per_piece"). Without it the log never comes off
     * stock — the apply job refuses to guess a basis.
     */
    quantity_basis: z.enum(["total", "per_piece"]).optional(),
    unit_cost: z.number().positive().optional(),
    unit_of_measure: z
      .enum(["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "kWh", "Liter", "Cubic_Meter", "Hour", "Other"])
      .optional(),
    consumption_type: z
      .enum(["sample", "production", "wastage", "energy_electricity", "energy_water", "energy_gas", "labor"])
      .optional(),
    location_id: z.string().optional(),
    notes: z.string().optional(),
  })
)
