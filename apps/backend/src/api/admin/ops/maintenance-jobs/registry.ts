import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { estimateDesignCostWorkflow } from "../../../../workflows/designs/estimate-design-cost"
import { DESIGN_MODULE } from "../../../../modules/designs"

/**
 * Admin "data-plumbing" maintenance jobs (#457 / roadmap #33).
 *
 * Each job is a guarded, API-driven data-correction action that follows the
 * same safe-by-default contract:
 *   - dry-run preview (default) → returns the changes it WOULD make, no writes
 *   - apply (dry_run=false)     → idempotent write, returns the changes made
 *
 * Jobs mostly surface + guard-rail existing endpoints/scripts so the recurring
 * "the code fix prevents recurrence but stored rows still need a targeted, safe
 * correction" incident no longer requires raw curl / one-off ECS run-task
 * scripts. This is the backend (API) layer; an admin Ops console can consume it.
 */

export type MaintenanceChange = {
  entity: string
  id: string
  field?: string
  before?: unknown
  after?: unknown
}

export type MaintenanceJobResult = {
  job_id: string
  dry_run: boolean
  /** true only when dry_run=false AND at least one field actually changed */
  applied: boolean
  summary: string
  changes: MaintenanceChange[]
}

export type MaintenanceJobParam = {
  name: string
  type: "string" | "number" | "boolean"
  required: boolean
  description: string
}

export type MaintenanceJob = {
  id: string
  label: string
  description: string
  /** Human/consumer-facing param descriptors (for the list endpoint + UI) */
  params: MaintenanceJobParam[]
  run: (
    container: any,
    opts: { dry_run: boolean; params: Record<string, unknown> }
  ) => Promise<MaintenanceJobResult>
}

/**
 * Pure diff between a design's currently-persisted cost fields and a freshly
 * computed estimate. Exported for unit testing — keeps the dry-run/apply logic
 * verifiable without booting the DB or the workflow engine.
 */
export function diffCostFields(
  designId: string,
  before: {
    estimated_cost?: number | null
    material_cost?: number | null
    production_cost?: number | null
  },
  after: { total_estimated: number; material_cost: number; production_cost: number }
): MaintenanceChange[] {
  const pairs: Array<[string, number | null | undefined, number]> = [
    ["estimated_cost", before.estimated_cost, after.total_estimated],
    ["material_cost", before.material_cost, after.material_cost],
    ["production_cost", before.production_cost, after.production_cost],
  ]

  const changes: MaintenanceChange[] = []
  for (const [field, rawBefore, afterValue] of pairs) {
    const beforeValue = rawBefore == null ? null : Number(rawBefore)
    if (beforeValue !== afterValue) {
      changes.push({ entity: "design", id: designId, field, before: beforeValue, after: afterValue })
    }
  }
  return changes
}

const recalcParamsSchema = z.object({
  design_id: z.string().min(1, "design_id is required"),
})

/**
 * Recalculate design cost — surfaces the same computation as
 * POST /admin/designs/:id/recalculate-cost, but with a dry-run preview that
 * shows the before/after of estimated/material/production cost WITHOUT
 * persisting. Apply mirrors that route's persist payload exactly.
 */
export const recalculateDesignCostJob: MaintenanceJob = {
  id: "recalculate-design-cost",
  label: "Recalculate design cost",
  description:
    "Re-estimate a design's material + production cost from its BOM and latest completed production run. Dry-run previews the before/after without persisting; apply writes the full breakdown back onto the design (idempotent).",
  params: [
    {
      name: "design_id",
      type: "string",
      required: true,
      description: "ID of the design to recalculate",
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = recalcParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { design_id } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: design_id },
      fields: ["id", "estimated_cost", "material_cost", "production_cost"],
    })

    if (!designs || designs.length === 0) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design not found: ${design_id}`)
    }
    const current = designs[0]

    const { result, errors } = await estimateDesignCostWorkflow(container).run({
      input: { design_id },
    })

    if (errors && errors.length > 0) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to estimate cost: ${errors
          .map((e: any) => e?.error?.message ?? String(e))
          .join("; ")}`
      )
    }

    const changes = diffCostFields(design_id, current, result)

    if (!dry_run && changes.length > 0) {
      const designService: any = container.resolve(DESIGN_MODULE)
      await designService.updateDesigns({
        id: design_id,
        estimated_cost: result.total_estimated,
        material_cost: result.material_cost,
        production_cost: result.production_cost,
        cost_breakdown: {
          items: result.breakdown?.materials ?? [],
          production_percent: result.breakdown?.production_percent,
          confidence: result.confidence,
          calculated_at: new Date().toISOString(),
          source: "ops_maintenance_recalculate",
        },
      })
    }

    const summary =
      changes.length === 0
        ? `No changes — design ${design_id} cost already up to date (total ${result.total_estimated})`
        : `${dry_run ? "Would update" : "Updated"} ${changes.length} field(s) on design ${design_id}; new total ${result.total_estimated} (${result.confidence})`

    return {
      job_id: recalculateDesignCostJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}

export const MAINTENANCE_JOBS: MaintenanceJob[] = [recalculateDesignCostJob]

export const getMaintenanceJob = (id: string): MaintenanceJob | undefined =>
  MAINTENANCE_JOBS.find((job) => job.id === id)
