import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { completeProductionRunWorkflow } from "../../../../../workflows/production-runs/complete-production-run"

const REJECTION_REASONS = [
  "stitching_defect",
  "fabric_flaw",
  "color_mismatch",
  "sizing_error",
  "print_defect",
  "material_damage",
  "quality_below_standard",
  "other",
] as const

const CompleteBodySchema = z.object({
  produced_quantity: z.number().min(0).optional(),
  rejected_quantity: z.number().min(0).optional(),
  rejection_reason: z.enum(REJECTION_REASONS).optional(),
  rejection_notes: z.string().optional(),
  partner_cost_estimate: z.number().positive().optional(),
  cost_type: z.enum(["per_unit", "total"]).optional(),
  consumptions: z
    .array(
      z.object({
        inventory_item_id: z.string().optional(),
        quantity: z.number().positive(),
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
    .optional(),
  notes: z.string().optional(),
})

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no actor ID" })
  }

  const rawBody = (req as any).validatedBody || req.body || {}
  const parsed = CompleteBodySchema.safeParse(rawBody)

  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  const body = parsed.data

  const { result, errors } = await completeProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: req.params.id,
      partner_id: partnerId,
      produced_quantity: body.produced_quantity,
      rejected_quantity: body.rejected_quantity,
      rejection_reason: body.rejection_reason,
      rejection_notes: body.rejection_notes,
      partner_cost_estimate: body.partner_cost_estimate,
      cost_type: body.cost_type,
      consumptions: body.consumptions,
      notes: body.notes,
    },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to complete production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const updated = await productionRunService.retrieveProductionRun(req.params.id)

  const loggedCount = (result as any)?.consumptions?.logged_ids?.length || 0

  return res.status(200).json({
    production_run: updated,
    consumptions_logged: loggedCount,
    message: loggedCount
      ? `Production run completed. ${loggedCount} consumption(s) recorded.`
      : "Production run completed",
  })
}
