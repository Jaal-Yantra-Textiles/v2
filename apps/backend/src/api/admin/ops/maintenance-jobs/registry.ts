import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { estimateDesignCostWorkflow } from "../../../../workflows/designs/estimate-design-cost"
import { DESIGN_MODULE } from "../../../../modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"

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

/**
 * Pure interpretation of a production run's cost estimate as BOTH a per-unit and
 * a total amount, given its `cost_type` and run quantity. This is the exact
 * reader-side math that bit #456 (a per-unit estimate stored/read as a total →
 * `7650 × 9 = 68850` double-multiply). Surfacing it in the dry-run preview makes
 * a normalisation mistake obvious BEFORE it's applied.
 *
 * Exported for unit testing — no container/DB.
 */
export function interpretRunCost(
  estimate: number | null | undefined,
  costType: "per_unit" | "total" | null | undefined,
  quantity: number
): { per_unit: number | null; total: number | null } {
  if (estimate == null || Number.isNaN(Number(estimate))) {
    return { per_unit: null, total: null }
  }
  const value = Number(estimate)
  const qty = quantity > 0 ? quantity : 1
  if (costType === "per_unit") {
    return { per_unit: value, total: value * qty }
  }
  // default / "total"
  return { per_unit: value / qty, total: value }
}

export type ProductionRunCostFields = {
  partner_cost_estimate?: number | null
  cost_type?: "per_unit" | "total" | null
}

/**
 * Pure diff between a production run's persisted cost fields and the operator's
 * requested correction. Only fields present in `after` (i.e. supplied by the
 * caller) are considered — an omitted field is left untouched. `null` is a
 * deliberate "clear the estimate" instruction, distinct from omitted.
 *
 * Exported for unit testing — no container/DB.
 */
export function diffRunCostFields(
  runId: string,
  before: ProductionRunCostFields,
  after: ProductionRunCostFields
): MaintenanceChange[] {
  const changes: MaintenanceChange[] = []

  if (after.partner_cost_estimate !== undefined) {
    const b = before.partner_cost_estimate == null ? null : Number(before.partner_cost_estimate)
    const a = after.partner_cost_estimate == null ? null : Number(after.partner_cost_estimate)
    if (b !== a) {
      changes.push({ entity: "production_run", id: runId, field: "partner_cost_estimate", before: b, after: a })
    }
  }

  if (after.cost_type !== undefined) {
    const b = before.cost_type ?? null
    const a = after.cost_type ?? null
    if (b !== a) {
      changes.push({ entity: "production_run", id: runId, field: "cost_type", before: b, after: a })
    }
  }

  return changes
}

const correctRunCostParamsSchema = z
  .object({
    production_run_id: z.string().min(1, "production_run_id is required"),
    partner_cost_estimate: z.union([z.number(), z.null()]).optional(),
    cost_type: z.enum(["per_unit", "total"]).optional(),
  })
  .refine(
    (v) => v.partner_cost_estimate !== undefined || v.cost_type !== undefined,
    { message: "provide at least one of partner_cost_estimate or cost_type to correct" }
  )

/**
 * Correct a production run's cost — surfaces the same edit as
 * POST /admin/production-runs/:id (partner_cost_estimate / cost_type), but with
 * a dry-run preview that shows how readers will interpret the corrected value
 * (per-unit AND total, given run quantity) so a normalisation mistake is obvious
 * before it's persisted. Mirrors the admin route's guard: a cancelled run is not
 * editable. Apply writes via updateProductionRuns (idempotent).
 */
export const correctProductionRunCostJob: MaintenanceJob = {
  id: "correct-production-run-cost",
  label: "Correct a production run's cost",
  description:
    "Set a production run's partner_cost_estimate and/or cost_type (per_unit | total). Dry-run previews the before/after AND how the corrected value reads as per-unit × quantity = total (the #456 double-multiply trap) without persisting; apply writes it back. A cancelled run cannot be edited.",
  params: [
    {
      name: "production_run_id",
      type: "string",
      required: true,
      description: "ID of the production run to correct",
    },
    {
      name: "partner_cost_estimate",
      type: "number",
      required: false,
      description: "New cost estimate (null clears it). At least one of this / cost_type is required.",
    },
    {
      name: "cost_type",
      type: "string",
      required: false,
      description: "How the estimate is expressed: 'per_unit' or 'total'. At least one of this / partner_cost_estimate is required.",
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = correctRunCostParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { production_run_id, partner_cost_estimate, cost_type } = parsed.data

    const service: any = container.resolve(PRODUCTION_RUNS_MODULE)

    let run: any
    try {
      run = await service.retrieveProductionRun(production_run_id)
    } catch {
      run = null
    }
    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run not found: ${production_run_id}`
      )
    }
    if (run.status === "cancelled") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot edit a cancelled production run"
      )
    }

    const after: ProductionRunCostFields = {}
    if (partner_cost_estimate !== undefined) after.partner_cost_estimate = partner_cost_estimate
    if (cost_type !== undefined) after.cost_type = cost_type

    const before: ProductionRunCostFields = {
      partner_cost_estimate: run.partner_cost_estimate ?? null,
      cost_type: run.cost_type ?? null,
    }

    const changes = diffRunCostFields(production_run_id, before, after)

    if (!dry_run && changes.length > 0) {
      const update: Record<string, unknown> = { id: production_run_id }
      if (after.partner_cost_estimate !== undefined) update.partner_cost_estimate = after.partner_cost_estimate
      if (after.cost_type !== undefined) update.cost_type = after.cost_type
      await service.updateProductionRuns(update)
    }

    // Effective (post-correction) values for the reader-side interpretation.
    const quantity = Number(run.quantity ?? 1)
    const effEstimate =
      after.partner_cost_estimate !== undefined ? after.partner_cost_estimate : before.partner_cost_estimate
    const effCostType = after.cost_type !== undefined ? after.cost_type : before.cost_type
    const interp = interpretRunCost(effEstimate, effCostType, quantity)

    const reads =
      interp.total == null
        ? "no cost set"
        : `reads as per-unit ${interp.per_unit} × qty ${quantity} = total ${interp.total} (cost_type ${effCostType ?? "total"})`

    const summary =
      changes.length === 0
        ? `No changes — production run ${production_run_id} cost already as requested; ${reads}`
        : `${dry_run ? "Would update" : "Updated"} ${changes.length} field(s) on production run ${production_run_id}; ${reads}`

    return {
      job_id: correctProductionRunCostJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}

export const MAINTENANCE_JOBS: MaintenanceJob[] = [
  recalculateDesignCostJob,
  recalculateDesignCostBulkJob,
  correctProductionRunCostJob,
]

export const getMaintenanceJob = (id: string): MaintenanceJob | undefined =>
  MAINTENANCE_JOBS.find((job) => job.id === id)
