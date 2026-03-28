import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { signalLifecycleStepSuccessWorkflow } from "../../../../../workflows/production-runs/production-run-steps"
import { awaitRunCompleteStepId } from "../../../../../workflows/production-runs/run-production-run-lifecycle"
import { logConsumptionWorkflow } from "../../../../../workflows/consumption-logs/log-consumption"
import { commitConsumptionWorkflow } from "../../../../../workflows/consumption-logs/commit-consumption"

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
  // Output / yield
  produced_quantity: z.number().min(0).optional(),
  rejected_quantity: z.number().min(0).optional(),
  rejection_reason: z.enum(REJECTION_REASONS).optional(),
  rejection_notes: z.string().optional(),

  // Cost
  partner_cost_estimate: z.number().positive().optional(),
  cost_type: z.enum(["per_unit", "total"]).optional(),

  // Consumptions (additional — may already have been logged during production)
  consumptions: z
    .array(
      z.object({
        inventory_item_id: z.string(),
        quantity: z.number().positive(),
        unit_cost: z.number().positive().optional(),
        unit_of_measure: z.enum(["Meter", "Yard", "Kilogram", "Gram", "Piece", "Roll", "Other"]).optional(),
        consumption_type: z.enum(["sample", "production", "wastage"]).optional(),
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

  const id = req.params.id

  const productionRunService: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(id)
    .catch(() => null)

  if (!run || (run as any).partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${id} not found`
    )
  }

  const status = (run as any).status
  if (status !== "in_progress") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Production run must be in_progress to complete. Current status: ${status}`
    )
  }

  if (!(run as any).finished_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Production run must be finished before it can be completed"
    )
  }

  // Parse body
  const parsed = CompleteBodySchema.safeParse(
    (req as any).validatedBody || req.body
  )
  const consumptions = parsed.success ? parsed.data.consumptions : undefined
  const partnerCostEstimate = parsed.success ? parsed.data.partner_cost_estimate : undefined
  const costType = parsed.success ? parsed.data.cost_type : undefined
  const completionNotes = parsed.success ? parsed.data.notes : undefined
  const producedQuantity = parsed.success ? parsed.data.produced_quantity : undefined
  const rejectedQuantity = parsed.success ? parsed.data.rejected_quantity : undefined
  const rejectionReason = parsed.success ? parsed.data.rejection_reason : undefined
  const rejectionNotes = parsed.success ? parsed.data.rejection_notes : undefined

  // Log consumptions if provided
  const loggedConsumptions: any[] = []
  if (consumptions?.length) {
    const designId = (run as any).design_id

    // Auto-resolve partner's default stock location if not specified per-item
    let defaultLocationId: string | undefined
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["stores.default_sales_channel_id"],
        filters: { id: partnerId },
      })
      const scId = partners?.[0]?.stores?.[0]?.default_sales_channel_id
      if (scId) {
        const { data: channels } = await query.graph({
          entity: "sales_channels",
          fields: ["stock_locations.id"],
          filters: { id: scId },
        })
        defaultLocationId = channels?.[0]?.stock_locations?.[0]?.id
      }
    } catch {
      // Non-fatal — location resolution is best-effort
    }

    for (const c of consumptions) {
      try {
        const { result } = await logConsumptionWorkflow(req.scope).run({
          input: {
            design_id: designId,
            inventory_item_id: c.inventory_item_id,
            quantity: c.quantity,
            unit_cost: c.unit_cost,
            unit_of_measure: c.unit_of_measure,
            consumption_type: c.consumption_type || "production",
            consumed_by: "partner",
            location_id: c.location_id || defaultLocationId,
            notes: c.notes,
            metadata: {
              production_run_id: id,
              logged_at_completion: true,
            },
          },
        })
        loggedConsumptions.push(result)

        // Auto-commit the consumption log
        if (result?.id) {
          try {
            await commitConsumptionWorkflow(req.scope).run({
              input: {
                design_id: (run as any).design_id,
                log_ids: [result.id],
              },
            })
          } catch {
            // Non-fatal — log was created, commit can happen later
          }
        }
      } catch (e: any) {
        console.error(
          `[production-run-complete] Failed to log consumption for ${c.inventory_item_id}:`,
          e.message
        )
      }
    }
  }

  // Normalize cost: if per_unit, compute total for storage; keep original for display
  const runQuantity = (run as any).quantity || 1
  const effectiveProduced = producedQuantity != null ? producedQuantity : runQuantity
  let normalizedCostEstimate = partnerCostEstimate
  if (partnerCostEstimate && costType === "per_unit") {
    normalizedCostEstimate = Math.round(partnerCostEstimate * effectiveProduced * 100) / 100
  }

  // Mark run as completed with proper columns
  await productionRunService.updateProductionRuns({
    id: run.id,
    status: "completed" as any,
    completed_at: new Date(),
    ...(producedQuantity != null ? { produced_quantity: producedQuantity } : {}),
    ...(rejectedQuantity != null ? { rejected_quantity: rejectedQuantity } : {}),
    ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
    ...(rejectionNotes ? { rejection_notes: rejectionNotes } : {}),
    ...(normalizedCostEstimate ? { partner_cost_estimate: normalizedCostEstimate } : {}),
    ...(costType ? { cost_type: costType } : {}),
    ...(completionNotes ? { completion_notes: completionNotes } : {}),
  })

  // Update design: store cost estimate (always use normalized total)
  // Design status is NOT auto-changed — admin reviews and approves explicitly
  if (normalizedCostEstimate && (run as any).design_id) {
    try {
      const designService = req.scope.resolve("design") as any
      await designService.updateDesigns({
        id: (run as any).design_id,
        production_cost: normalizedCostEstimate,
      })
    } catch {
      // Non-fatal
    }
  }

  // Emit event for subscribers (e.g. sample cost calculation)
  try {
    const eventService = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([{
      name: "production_run.completed",
      data: {
        id: run.id,
        production_run_id: run.id,
        partner_id: partnerId,
        action: "completed",
        notes: completionNotes,
        produced_quantity: effectiveProduced,
        rejected_quantity: rejectedQuantity || 0,
      },
    }])
  } catch {
    // Non-fatal
  }

  // Signal the lifecycle workflow
  const transactionId = (run as any).metadata?.lifecycle_transaction_id
  if (transactionId) {
    await signalLifecycleStepSuccessWorkflow(req.scope)
      .run({
        input: {
          transaction_id: transactionId,
          step_id: awaitRunCompleteStepId,
        },
      })
      .catch(() => {
        // No lifecycle workflow running — safe to ignore
      })
  }

  const updated = await productionRunService.retrieveProductionRun(id)

  return res.status(200).json({
    production_run: updated,
    consumptions_logged: loggedConsumptions.length,
    message: loggedConsumptions.length
      ? `Production run completed. ${loggedConsumptions.length} consumption(s) recorded.`
      : "Production run completed",
  })
}
