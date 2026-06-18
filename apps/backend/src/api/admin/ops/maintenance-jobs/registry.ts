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
  /**
   * Per-entity errors for batch jobs — a single bad id (e.g. a deleted design)
   * is recorded here instead of aborting the whole run. Omitted for
   * single-entity jobs (which throw a MedusaError → HTTP status instead).
   */
  errors?: Array<{ id: string; message: string }>
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

type DesignCostEstimate = {
  total_estimated: number
  material_cost: number
  production_cost: number
  confidence: string
  breakdown?: { materials?: unknown[]; production_percent?: number }
}

/**
 * Shared compute used by both the single- and bulk-recalculate jobs: load the
 * design's currently-persisted cost fields and run the (read-only) estimate
 * workflow. Throws NOT_FOUND if the design is gone and UNEXPECTED_STATE if the
 * workflow itself fails — so callers get the right HTTP status for free.
 */
export async function recomputeDesignCost(
  container: any,
  designId: string
): Promise<{
  current: { estimated_cost?: number | null; material_cost?: number | null; production_cost?: number | null }
  result: DesignCostEstimate
}> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: ["id", "estimated_cost", "material_cost", "production_cost"],
  })

  if (!designs || designs.length === 0) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Design not found: ${designId}`)
  }

  const { result, errors } = await estimateDesignCostWorkflow(container).run({
    input: { design_id: designId },
  })

  if (errors && errors.length > 0) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed to estimate cost: ${errors
        .map((e: any) => e?.error?.message ?? String(e))
        .join("; ")}`
    )
  }

  return { current: designs[0], result: result as DesignCostEstimate }
}

/** Persist a freshly-computed estimate back onto a design (idempotent). */
export async function persistDesignCost(
  container: any,
  designId: string,
  result: DesignCostEstimate
): Promise<void> {
  const designService: any = container.resolve(DESIGN_MODULE)
  await designService.updateDesigns({
    id: designId,
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

    const { current, result } = await recomputeDesignCost(container, design_id)
    const changes = diffCostFields(design_id, current, result)

    if (!dry_run && changes.length > 0) {
      await persistDesignCost(container, design_id, result)
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

/**
 * Hard cap on the bulk recalculate job: each id runs the estimate workflow
 * synchronously, so we keep the per-request blast radius operator-bounded and
 * the endpoint responsive. Larger corrections should be chunked across calls.
 */
export const MAX_BULK_DESIGNS = 25

/**
 * Pure normaliser for the bulk job's `design_ids` param. Accepts either a real
 * array or a comma/whitespace/newline-separated string (handy for pasting a
 * column out of a spreadsheet). Trims, drops blanks, de-duplicates while
 * preserving order, and enforces the 1..MAX_BULK_DESIGNS bound. Exported for
 * unit testing — no container/DB needed.
 */
export function parseDesignIds(input: unknown): string[] {
  let raw: unknown[]
  if (Array.isArray(input)) {
    raw = input
  } else if (typeof input === "string") {
    raw = input.split(/[\s,]+/)
  } else {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "design_ids is required (array or comma-separated string of design ids)"
    )
  }

  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of raw) {
    const id = typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  if (ids.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "design_ids must contain at least one non-empty id"
    )
  }
  if (ids.length > MAX_BULK_DESIGNS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `design_ids exceeds the per-request limit of ${MAX_BULK_DESIGNS} (got ${ids.length}); split into smaller batches`
    )
  }
  return ids
}

/**
 * Pure summary builder for the bulk job — keeps the human-facing string logic
 * verifiable without booting the workflow engine.
 */
export function summarizeBulkRecalc(
  dryRun: boolean,
  idCount: number,
  changedDesignCount: number,
  changeCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would update" : "Updated"
  const head =
    changeCount === 0
      ? `No changes — ${idCount} design(s) already up to date`
      : `${verb} ${changeCount} field(s) across ${changedDesignCount}/${idCount} design(s)`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

/**
 * Bulk recalculate design cost — same per-design compute as
 * `recalculate-design-cost`, but over an explicit, capped list of ids so an
 * operator can re-correct many drifted designs in one guarded call after a
 * cost-logic fix. Dry-run (default) previews the full aggregate change set;
 * one bad/deleted id is reported in `errors` instead of failing the batch.
 */
export const recalculateDesignCostBulkJob: MaintenanceJob = {
  id: "recalculate-design-cost-bulk",
  label: "Recalculate design cost (bulk)",
  description:
    `Re-estimate material + production cost for an explicit list of designs (max ${MAX_BULK_DESIGNS} per call). Dry-run previews the aggregate before/after without persisting; apply writes each design's breakdown back (idempotent). A missing/deleted id is reported per-design and does not abort the batch.`,
  params: [
    {
      name: "design_ids",
      type: "string",
      required: true,
      description: `Design ids to recalculate — array or comma-separated string (max ${MAX_BULK_DESIGNS})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const ids = parseDesignIds((params as any).design_ids)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const changedDesigns = new Set<string>()

    for (const designId of ids) {
      try {
        const { current, result } = await recomputeDesignCost(container, designId)
        const designChanges = diffCostFields(designId, current, result)
        if (designChanges.length > 0) {
          changedDesigns.add(designId)
          changes.push(...designChanges)
          if (!dry_run) {
            await persistDesignCost(container, designId, result)
          }
        }
      } catch (e: any) {
        errors.push({ id: designId, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: recalculateDesignCostBulkJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeBulkRecalc(
        dry_run,
        ids.length,
        changedDesigns.size,
        changes.length,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

export const MAINTENANCE_JOBS: MaintenanceJob[] = [
  recalculateDesignCostJob,
  recalculateDesignCostBulkJob,
]

export const getMaintenanceJob = (id: string): MaintenanceJob | undefined =>
  MAINTENANCE_JOBS.find((job) => job.id === id)
