import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { estimateDesignCostWorkflow } from "../../../../workflows/designs/estimate-design-cost"
import { DESIGN_MODULE } from "../../../../modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import { RAW_MATERIAL_MODULE } from "../../../../modules/raw_material"
import { OPS_AUDIT_MODULE } from "../../../../modules/ops_audit"
import { STATS_MODULE } from "../../../../modules/stats"
import { PARTNER_BILLING_MODULE } from "../../../../modules/partner_billing"
import { AD_PLANNING_MODULE } from "../../../../modules/ad-planning"
import { PERSON_MODULE } from "../../../../modules/person"
import {
  derivePersonName,
  isUsableEmail,
} from "../../../../workflows/ad-planning/conversions/person-identity-lib"
import { computeFee } from "../../../../modules/partner_billing/compute-fee"
import { resolvePartnerFeeRate } from "../../../../modules/partner_billing/resolve-fee-rate"
import partnerOrderLink from "../../../../links/partner-order"
import partnerRegionLink from "../../../../links/partner-region"
import productGoogleMerchantLink from "../../../../links/product-google-merchant-link"
import productionRunConsumptionLogLink from "../../../../links/production-runs-consumption-logs"
import { resolveStoreCurrency } from "../../../../lib/resolve-store-currency"
import {
  normalizeLandingBase,
  resolvePartnerLandingBase,
} from "../../../../workflows/google_merchant/steps/resolve-partner-landing-base"
import { syncProductToGoogleWorkflow } from "../../../../workflows/google_merchant/workflows/sync-product-to-google"
import { MARKETING_MODULE } from "../../../../modules/marketing"
import {
  reconcileOutreachBatch,
  selectSyncableOutreach,
  summarizeOutreachSync,
  type OutreachSyncEvent,
  type OutreachSyncRow,
} from "../../../../modules/marketing/outreach-sync-lib"
import {
  runDailyIdeasEmail,
  type DailyIdeasEmailSummary,
} from "../../../../workflows/marketing/run-daily-ideas-email"
import { sendIdeasEmailWorkflow } from "../../../../workflows/marketing/send-ideas-email"
import { VISUAL_FLOWS_MODULE } from "../../../../modules/visual_flows"
import { FLOW_DEF as IDEAS_EMAIL_FLOW_DEF } from "../../../../scripts/seed-marketing-daily-ideas-email-flow"

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

/**
 * Hard cap on the inventory-unit-cost backfill scan. Each item runs two
 * `query.graph` lookups synchronously, so we bound the per-request blast radius
 * and keep the endpoint responsive. Bigger sweeps raise the `limit` param
 * across chunked calls.
 */
export const MAX_INVENTORY_SCAN = 5000

const backfillUnitCostParamsSchema = z.object({
  /** Recompute even when the raw material already has a positive unit_cost. */
  force: z.boolean().optional().default(false),
  /** Max inventory items to scan in one call (1..MAX_INVENTORY_SCAN). */
  limit: z.number().int().positive().max(MAX_INVENTORY_SCAN).optional().default(1000),
})

/** Shape of one `inventory_order_line_inventory_item` link row, as queried. */
export type InventoryOrderLineLink = {
  inventory_order_line?: {
    id?: string
    price?: number | string | null
    inventory_orders?: {
      id?: string
      order_date?: string | Date | null
      status?: string | null
    } | null
  } | null
}

/**
 * Pure: pick the most recent non-cancelled inventory order line with a positive
 * price for one inventory item. Mirrors the heuristic of the
 * `backfill-inventory-unit-cost` script (latest order_date wins) but is
 * container-free so the dry-run/apply selection is unit-testable. Returns null
 * when no usable price exists (no history / all cancelled / non-positive).
 */
export function pickLatestOrderLinePrice(
  links: InventoryOrderLineLink[]
): { price: number; order_id: string | null; order_date: string | null } | null {
  let best: { price: number; order_id: string | null; date: Date } | null = null

  for (const link of links || []) {
    const line = link?.inventory_order_line
    if (!line) continue
    const order = line.inventory_orders
    if (!order || order.status === "Cancelled") continue

    const price = Number(line.price) || 0
    if (price <= 0) continue

    const orderDate = order.order_date ? new Date(order.order_date) : new Date(0)
    if (!best || orderDate > best.date) {
      best = { price, order_id: order.id ?? null, date: orderDate }
    }
  }

  if (!best) return null
  return {
    price: best.price,
    order_id: best.order_id,
    order_date: best.date.getTime() === 0 ? null : best.date.toISOString(),
  }
}

/**
 * Pure: diff a raw material's currently-stored unit_cost against a derived
 * price. Returns a single `unit_cost` change (or none when already equal).
 * Exported for unit testing.
 */
export function diffUnitCost(
  rawMaterialId: string,
  before: number | string | null | undefined,
  after: number
): MaintenanceChange[] {
  const beforeValue = before == null ? null : Number(before)
  if (beforeValue === after) return []
  return [{ entity: "raw_material", id: rawMaterialId, field: "unit_cost", before: beforeValue, after }]
}

/**
 * Pure summary builder for the inventory-unit-cost backfill — keeps the
 * human-facing string verifiable without booting the DB.
 */
export function summarizeUnitCostBackfill(
  dryRun: boolean,
  scanned: number,
  changedCount: number,
  noRawMaterialCount: number,
  noHistoryCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would set" : "Set"
  const head =
    changedCount === 0
      ? `No changes — scanned ${scanned} inventory item(s), none needed a unit_cost correction`
      : `${verb} unit_cost on ${changedCount} raw material(s) (scanned ${scanned} inventory item(s))`
  const skips: string[] = []
  if (noRawMaterialCount > 0) skips.push(`${noRawMaterialCount} unlinked`)
  if (noHistoryCount > 0) skips.push(`${noHistoryCount} no order history`)
  const tail = skips.length ? `; ${skips.join(", ")}` : ""
  return errorCount > 0 ? `${head}${tail}; ${errorCount} error(s)` : `${head}${tail}`
}

/**
 * Backfill raw-material unit_cost from inventory order history — promotes the
 * one-off `backfill-inventory-unit-cost` script into a guarded, API-driven job
 * (#457). For each inventory item linked to a raw material with no (or zero)
 * unit_cost, it derives the cost from the most recent non-cancelled inventory
 * order line price. Dry-run (default) previews every before→after without
 * persisting; apply writes `unit_cost` via the raw_materials module (idempotent
 * — re-running is a no-op once costs match). Items with no raw-material link or
 * no order history are counted in the summary, not treated as errors; a genuine
 * per-item failure is reported in `errors` instead of aborting the sweep.
 */
export const backfillInventoryUnitCostJob: MaintenanceJob = {
  id: "backfill-inventory-unit-cost",
  label: "Backfill inventory unit cost",
  description:
    `Derive raw-material unit_cost from the latest non-cancelled inventory order line for each linked inventory item. Dry-run previews the before/after without persisting; apply writes unit_cost back (idempotent). By default only fills missing/zero costs — set force=true to recompute existing ones. Scans up to 'limit' items per call (default 1000, max ${MAX_INVENTORY_SCAN}).`,
  params: [
    {
      name: "force",
      type: "boolean",
      required: false,
      description: "Recompute unit_cost even when a positive value already exists (default false)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max inventory items to scan in one call (default 1000, max ${MAX_INVENTORY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillUnitCostParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { force, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const inventoryService: any = container.resolve(Modules.INVENTORY)
    const rawMaterialService: any = container.resolve(RAW_MATERIAL_MODULE)

    const items: any[] = await inventoryService.listInventoryItems({}, { take: limit })

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const changedRawMaterials = new Set<string>()
    let noRawMaterial = 0
    let noHistory = 0

    for (const item of items) {
      try {
        let rawMaterial: any = null
        try {
          const { data: rmLinks } = await query.graph({
            entity: "inventory_item_raw_materials",
            filters: { inventory_item_id: item.id },
            fields: ["raw_materials.*"],
          })
          rawMaterial = rmLinks?.[0]?.raw_materials
        } catch {
          // No link table row / not linked — treated as "unlinked" below.
        }

        if (!rawMaterial) {
          noRawMaterial++
          continue
        }

        const hasExistingCost =
          rawMaterial.unit_cost != null && Number(rawMaterial.unit_cost) > 0
        if (hasExistingCost && !force) {
          continue
        }

        const { data: orderLineLinks } = await query.graph({
          entity: "inventory_order_line_inventory_item",
          filters: { inventory_item_id: item.id },
          fields: [
            "inventory_order_line.id",
            "inventory_order_line.price",
            "inventory_order_line.inventory_orders.order_date",
            "inventory_order_line.inventory_orders.status",
            "inventory_order_line.inventory_orders.id",
          ],
        })

        const latest = pickLatestOrderLinePrice(orderLineLinks || [])
        if (!latest) {
          noHistory++
          continue
        }

        const rmChanges = diffUnitCost(rawMaterial.id, rawMaterial.unit_cost, latest.price)
        if (rmChanges.length === 0) {
          continue
        }

        changedRawMaterials.add(rawMaterial.id)
        changes.push(...rmChanges)

        if (!dry_run) {
          await rawMaterialService.updateRawMaterials({
            id: rawMaterial.id,
            unit_cost: latest.price,
          })
        }
      } catch (e: any) {
        errors.push({ id: item.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillInventoryUnitCostJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeUnitCostBackfill(
        dry_run,
        items.length,
        changedRawMaterials.size,
        noRawMaterial,
        noHistory,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the energy-cost backfill scan. Without an explicit design_id the
 * job sweeps every design that has a completed production run, running several
 * synchronous lookups each, so we bound the per-request blast radius. Bigger
 * sweeps raise the `limit` param across chunked calls.
 */
export const MAX_DESIGN_SCAN = 2000

/** Consumption-log types that contribute to the three cost buckets. */
export const MATERIAL_CONSUMPTION_TYPES = ["sample", "production", "wastage"]
export const ENERGY_CONSUMPTION_TYPES = ["energy_electricity", "energy_water", "energy_gas"]

const backfillEnergyParamsSchema = z.object({
  /** Process a single design instead of sweeping all completed-run designs. */
  design_id: z.string().min(1).optional(),
  /** Recompute even when cost_breakdown already has energy_cost_total. */
  force: z.boolean().optional().default(false),
  /** Max designs to scan in one sweep when no design_id is given. */
  limit: z.number().int().positive().max(MAX_DESIGN_SCAN).optional().default(1000),
})

export const round2 = (n: number): number => Math.round(n * 100) / 100

/** Shape of one energy_rates row, as consumed by the rate map. */
export type EnergyRateRow = {
  energy_type?: string | null
  rate_per_unit?: number | string | null
  name?: string | null
  effective_from?: string | Date | null
}

/**
 * Pure: collapse the active energy_rates rows into the single most-recently
 * effective rate per energy_type (latest effective_from wins). Mirrors the
 * `backfill-design-energy-costs` script's rate selection but is container-free
 * so the cost math is unit-testable. Exported for testing.
 */
export function buildEnergyRateMap(
  rates: EnergyRateRow[]
): Map<string, { rate_per_unit: number; name: string }> {
  const map = new Map<string, { rate_per_unit: number; name: string; effective_from: number }>()
  for (const rate of rates || []) {
    const key = rate?.energy_type
    if (!key) continue
    const effectiveFrom = rate.effective_from ? new Date(rate.effective_from).getTime() : 0
    const existing = map.get(key)
    if (!existing || effectiveFrom > existing.effective_from) {
      map.set(key, {
        rate_per_unit: Number(rate.rate_per_unit) || 0,
        name: rate.name ?? "",
        effective_from: effectiveFrom,
      })
    }
  }
  // Strip the internal sort key from the returned shape.
  const out = new Map<string, { rate_per_unit: number; name: string }>()
  for (const [k, v] of map) out.set(k, { rate_per_unit: v.rate_per_unit, name: v.name })
  return out
}

/** Shape of one consumption_log row used by the energy/labor cost math. */
export type ConsumptionLogRow = {
  consumption_type?: string | null
  quantity?: number | string | null
  unit_cost?: number | string | null
  unit_of_measure?: string | null
}

/**
 * Pure: total the energy consumption logs, falling back to the active
 * per-type rate when a log carries no unit_cost. Returns the rounded total plus
 * a per-line breakdown (with the cost source) for the persisted cost_breakdown.
 */
export function computeEnergyCost(
  energyLogs: ConsumptionLogRow[],
  rateMap: Map<string, { rate_per_unit: number; name: string }>
): { total: number; items: Array<Record<string, unknown>> } {
  let total = 0
  const items: Array<Record<string, unknown>> = []
  for (const log of energyLogs || []) {
    const qty = Number(log.quantity) || 0
    let unitCost = Number(log.unit_cost) || 0
    let costSource = "partner_input"
    if (!unitCost) {
      const rateInfo = log.consumption_type ? rateMap.get(log.consumption_type) : undefined
      if (rateInfo && rateInfo.rate_per_unit > 0) {
        unitCost = rateInfo.rate_per_unit
        costSource = "energy_rate"
      } else {
        costSource = "none"
      }
    }
    const lineTotal = qty * unitCost
    total += lineTotal
    items.push({
      consumption_type: log.consumption_type,
      quantity: qty,
      unit_cost: unitCost,
      unit_of_measure: log.unit_of_measure,
      line_total: lineTotal,
      cost_source: costSource,
    })
  }
  return { total: round2(total), items }
}

/**
 * Pure: total the labor consumption logs, falling back to the active "labor"
 * rate when a log carries no unit_cost. Returns the rounded cost plus the total
 * labor hours.
 */
export function computeLaborCost(
  laborLogs: ConsumptionLogRow[],
  rateMap: Map<string, { rate_per_unit: number; name: string }>
): { total: number; hours: number } {
  let total = 0
  let hours = 0
  for (const log of laborLogs || []) {
    const qty = Number(log.quantity) || 0
    hours += qty
    let unitCost = Number(log.unit_cost) || 0
    if (!unitCost) unitCost = rateMap.get("labor")?.rate_per_unit || 0
    total += qty * unitCost
  }
  return { total: round2(total), hours: round2(hours) }
}

/**
 * Pure: diff a design's currently-persisted cost fields against the freshly
 * computed values. Compares the three top-level cost columns plus the
 * cost_breakdown's energy_cost_total. Rounded inputs make re-running idempotent.
 * Exported for unit testing.
 */
export function diffEnergyCostFields(
  designId: string,
  before: {
    estimated_cost?: number | null
    material_cost?: number | null
    production_cost?: number | null
    energy_cost_total?: number | null
  },
  after: {
    estimated_cost: number
    material_cost: number
    production_cost: number
    energy_cost_total: number
  }
): MaintenanceChange[] {
  const pairs: Array<[string, number | null | undefined, number]> = [
    ["estimated_cost", before.estimated_cost, after.estimated_cost],
    ["material_cost", before.material_cost, after.material_cost],
    ["production_cost", before.production_cost, after.production_cost],
    ["energy_cost_total", before.energy_cost_total, after.energy_cost_total],
  ]
  const changes: MaintenanceChange[] = []
  for (const [field, rawBefore, afterValue] of pairs) {
    let beforeValue = rawBefore == null ? null : Number(rawBefore)
    let afterCompare: number | null = afterValue
    // #483 follow-up: energy_cost_total is persisted as `undefined` (i.e. absent)
    // when it computes to 0 — see the apply payload's `energy_cost_total > 0 ?`
    // guard. So a labor-only design (no energy logs → energyCost 0) read back as
    // `null` would otherwise diff null→0 on EVERY sweep, re-writing forever.
    // Treat 0 and null/absent as equivalent for this field on both sides so the
    // job is genuinely idempotent for energy-free designs.
    if (field === "energy_cost_total") {
      if (beforeValue === 0) beforeValue = null
      if (afterCompare === 0) afterCompare = null
    }
    if (beforeValue !== afterCompare) {
      changes.push({ entity: "design", id: designId, field, before: beforeValue, after: afterValue })
    }
  }
  return changes
}

/**
 * Pure summary builder for the energy-cost backfill — keeps the human-facing
 * string verifiable without booting the DB.
 */
export function summarizeEnergyBackfill(
  dryRun: boolean,
  scanned: number,
  changedCount: number,
  alreadyHadCount: number,
  noLogsCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would update" : "Updated"
  const head =
    changedCount === 0
      ? `No changes — scanned ${scanned} design(s), none needed an energy/labor cost backfill`
      : `${verb} cost on ${changedCount} design(s) (scanned ${scanned})`
  const skips: string[] = []
  if (alreadyHadCount > 0) skips.push(`${alreadyHadCount} already had energy costs`)
  if (noLogsCount > 0) skips.push(`${noLogsCount} no energy/labor logs`)
  const tail = skips.length ? `; ${skips.join(", ")}` : ""
  return errorCount > 0 ? `${head}${tail}; ${errorCount} error(s)` : `${head}${tail}`
}

/**
 * Backfill energy & labor costs into design cost breakdowns — promotes the
 * one-off `backfill-design-energy-costs` script into a guarded, API-driven job
 * (#457). For each design with committed energy/labor consumption logs it
 * recomputes material + energy + labor + production cost (energy/labor priced
 * from the log's unit_cost, else the latest active energy_rate) and diffs the
 * result against what's persisted. Dry-run (default) previews every before→after
 * without writing; apply persists the recomputed cost_breakdown (idempotent —
 * re-running is a no-op once costs match). By default a design that already has
 * energy_cost_total is skipped — set force=true to recompute it. Pass a single
 * design_id to target one design, or sweep up to `limit` designs that have a
 * completed production run.
 */
export const backfillDesignEnergyCostJob: MaintenanceJob = {
  id: "backfill-design-energy-costs",
  label: "Backfill design energy & labor costs",
  description:
    `Recompute and persist energy + labor costs into a design's cost_breakdown from its committed consumption logs (priced from the log unit_cost, else the latest active energy_rate). Dry-run previews the before/after without persisting; apply writes the recomputed breakdown (idempotent). By default skips designs that already have energy_cost_total — set force=true to recompute. Pass design_id to target one design, or sweep up to 'limit' completed-run designs (default 1000, max ${MAX_DESIGN_SCAN}).`,
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Process a single design instead of sweeping all completed-run designs",
    },
    {
      name: "force",
      type: "boolean",
      required: false,
      description: "Recompute even when cost_breakdown already has energy_cost_total (default false)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max designs to scan in one sweep when no design_id is given (default 1000, max ${MAX_DESIGN_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillEnergyParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { design_id, force, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const inventoryService: any = container.resolve(Modules.INVENTORY)
    const designService: any = container.resolve(DESIGN_MODULE)
    const consumptionLogService: any = container.resolve("consumption_log")
    const productionRunService: any = container.resolve("production_runs")
    const energyRateService: any = container.resolve("energy_rates")

    // Active energy rates → latest-effective rate per type (pure).
    const [activeRates] = await energyRateService.listAndCountEnergyRates(
      { is_active: true },
      { take: null }
    )
    const rateMap = buildEnergyRateMap(activeRates || [])

    // Resolve the design id set: one explicit id, or the completed-run designs.
    let designIds: string[]
    if (design_id) {
      designIds = [design_id]
    } else {
      const [completedRuns] = await productionRunService.listAndCountProductionRuns(
        { status: "completed" },
        { take: null }
      )
      designIds = [...new Set((completedRuns || []).map((r: any) => r.design_id).filter(Boolean))]
        .slice(0, limit) as string[]
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const changedDesigns = new Set<string>()
    let alreadyHad = 0
    let noLogs = 0

    for (const designId of designIds) {
      try {
        const design: any = await designService.retrieveDesign(designId).catch(() => null)
        if (!design) {
          errors.push({ id: designId, message: "Design not found" })
          continue
        }

        const existingBreakdown = (design.cost_breakdown as any) || {}
        if (existingBreakdown.energy_cost_total && !force) {
          alreadyHad++
          continue
        }

        const [allLogs] = await consumptionLogService.listAndCountConsumptionLogs(
          { design_id: designId, is_committed: true },
          { take: null }
        )
        if (!allLogs || !allLogs.length) {
          noLogs++
          continue
        }

        const materialLogs = allLogs.filter((l: any) =>
          MATERIAL_CONSUMPTION_TYPES.includes(l.consumption_type)
        )
        const energyLogs = allLogs.filter((l: any) =>
          ENERGY_CONSUMPTION_TYPES.includes(l.consumption_type)
        )
        const laborLogs = allLogs.filter((l: any) => l.consumption_type === "labor")

        // Nothing to backfill if there are no energy or labor logs.
        if (!energyLogs.length && !laborLogs.length) {
          noLogs++
          continue
        }

        // Material cost (impure: per-log inventory + raw-material lookups).
        let materialCost = 0
        const materialItems: any[] = []
        for (const log of materialLogs) {
          let unitCost = Number(log.unit_cost) || 0
          let costSource = "partner_input"
          let title = log.inventory_item_id || "unknown"
          if (log.inventory_item_id) {
            try {
              const item = await inventoryService.retrieveInventoryItem(log.inventory_item_id)
              title = item.title || item.sku || log.inventory_item_id
            } catch {
              /* keep fallback title */
            }
            if (!unitCost) {
              try {
                const { data: rmLinks } = await query.graph({
                  entity: "inventory_item_raw_materials",
                  filters: { inventory_item_id: log.inventory_item_id },
                  fields: ["raw_materials.unit_cost"],
                })
                const rmCost = Number(rmLinks?.[0]?.raw_materials?.unit_cost) || 0
                if (rmCost > 0) {
                  unitCost = rmCost
                  costSource = "raw_material"
                } else {
                  costSource = "none"
                }
              } catch {
                costSource = "none"
              }
            }
          }
          const lineTotal = Number(log.quantity) * unitCost
          materialCost += lineTotal
          materialItems.push({
            inventory_item_id: log.inventory_item_id,
            title,
            quantity: Number(log.quantity),
            unit_cost: unitCost,
            line_total: lineTotal,
            cost_source: costSource,
          })
        }

        const { total: energyCost, items: energyItems } = computeEnergyCost(energyLogs, rateMap)
        const { total: laborCost, hours: laborHours } = computeLaborCost(laborLogs, rateMap)

        // Production cost: preserve existing, else partner estimate, else 30%.
        let productionCost = Number(design.production_cost) || 0
        let productionSource = existingBreakdown.production_cost_source || "existing"
        if (!productionCost) {
          try {
            const [runs] = await productionRunService.listAndCountProductionRuns(
              { design_id: designId, status: "completed" },
              { take: 1, order: { completed_at: "DESC" } }
            )
            const partnerEst = Number(runs?.[0]?.partner_cost_estimate) || 0
            if (partnerEst > 0) {
              productionCost = partnerEst
              productionSource = "partner_estimate"
            }
          } catch {
            /* fall through to overhead */
          }
          if (!productionCost) {
            productionCost = materialCost * 0.3
            productionSource = "overhead_percent"
          }
        }

        const roundedMaterial = round2(materialCost)
        const roundedProduction = round2(productionCost)
        const totalEstimate = round2(roundedMaterial + roundedProduction + energyCost + laborCost)

        const designChanges = diffEnergyCostFields(
          designId,
          {
            estimated_cost: design.estimated_cost,
            material_cost: design.material_cost,
            production_cost: design.production_cost,
            energy_cost_total: existingBreakdown.energy_cost_total,
          },
          {
            estimated_cost: totalEstimate,
            material_cost: roundedMaterial,
            production_cost: roundedProduction,
            energy_cost_total: energyCost,
          }
        )

        if (designChanges.length === 0) continue

        changedDesigns.add(designId)
        changes.push(...designChanges)

        if (!dry_run) {
          await designService.updateDesigns({
            id: designId,
            estimated_cost: totalEstimate,
            material_cost: roundedMaterial,
            production_cost: roundedProduction,
            cost_breakdown: {
              items: materialItems.length > 0 ? materialItems : existingBreakdown.items,
              energy_costs: energyItems.length > 0 ? energyItems : undefined,
              energy_cost_total: energyCost > 0 ? energyCost : undefined,
              labor_cost_total: laborCost > 0 ? laborCost : undefined,
              labor_hours: laborHours > 0 ? laborHours : undefined,
              service_costs: existingBreakdown.service_costs,
              service_cost_total: existingBreakdown.service_cost_total,
              production_cost_source: productionSource,
              production_overhead_percent:
                productionSource === "overhead_percent" ? 30 : undefined,
              partner_cost_estimate: existingBreakdown.partner_cost_estimate,
              calculated_at: new Date().toISOString(),
              source: "ops_maintenance_backfill_energy_costs",
              previous_estimated_cost: design.estimated_cost || undefined,
            },
          })
        }
      } catch (e: any) {
        errors.push({ id: designId, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillDesignEnergyCostJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeEnergyBackfill(
        dry_run,
        designIds.length,
        changedDesigns.size,
        alreadyHad,
        noLogs,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on how many audit rows a single prune call may delete. Each pruned
 * row is enumerated in `changes` (and therefore stored in THIS prune run's own
 * audit row), so we bound the per-call blast radius and avoid bloating the very
 * table we're pruning. Larger backlogs are drained across repeated calls.
 */
export const MAX_AUDIT_PRUNE = 5000

const pruneAuditParamsSchema = z.object({
  /** Only prune audit rows created strictly before now − this many days. */
  older_than_days: z
    .number()
    .int()
    .positive("older_than_days must be a positive integer"),
  /**
   * By default only the noisy dry-run *preview* rows are pruned; applied rows
   * (the durable record of an actual write) are retained. Set true to prune
   * applied rows too.
   */
  include_applied: z.boolean().optional().default(false),
  /** Max audit rows to prune in one call (1..MAX_AUDIT_PRUNE). */
  limit: z.number().int().positive().max(MAX_AUDIT_PRUNE).optional().default(1000),
})

/**
 * Pure: the cutoff instant for a retention prune — rows created strictly before
 * this are eligible. Exported so the date math is unit-testable without a clock
 * dependency (caller passes "now").
 */
export function computePruneCutoff(now: Date, olderThanDays: number): Date {
  return new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000)
}

/**
 * Pure summary builder for the audit-log prune — keeps the human-facing string
 * verifiable without booting the DB.
 */
export function summarizeAuditPrune(
  dryRun: boolean,
  matched: number,
  olderThanDays: number,
  includeApplied: boolean
): string {
  const scope = includeApplied ? "dry-run + applied" : "dry-run-only"
  if (matched === 0) {
    return `No changes — no ${scope} audit rows older than ${olderThanDays} day(s)`
  }
  const verb = dryRun ? "Would prune" : "Pruned"
  return `${verb} ${matched} ${scope} audit row(s) older than ${olderThanDays} day(s)`
}

/**
 * Prune the ops-maintenance audit log (#457 retention tail). Deletes
 * `ops_maintenance_run` rows older than `older_than_days`. Safe by default in
 * two ways: dry-run (default) only previews the matched rows, and only the noisy
 * dry-run *preview* rows are eligible unless `include_applied=true` (so the
 * durable record of actual writes is retained by default). Bounded by `limit`
 * (oldest-first) so a single call can't delete an unbounded set. Idempotent:
 * once the backlog is drained, re-running matches nothing.
 */
export const pruneOpsAuditRunsJob: MaintenanceJob = {
  id: "prune-ops-audit-runs",
  label: "Prune ops audit log",
  description:
    `Delete old ops-maintenance audit rows (ops_maintenance_run) older than 'older_than_days'. Dry-run (default) previews exactly which rows would be pruned without deleting; apply deletes them. By default only dry-run preview rows are eligible — set include_applied=true to also prune applied rows (the durable record of real writes). Prunes up to 'limit' oldest rows per call (default 1000, max ${MAX_AUDIT_PRUNE}).`,
  params: [
    {
      name: "older_than_days",
      type: "number",
      required: true,
      description: "Prune audit rows created more than this many days ago",
    },
    {
      name: "include_applied",
      type: "boolean",
      required: false,
      description:
        "Also prune rows from applied (non-dry-run) runs (default false — applied rows are retained)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max audit rows to prune in one call, oldest first (default 1000, max ${MAX_AUDIT_PRUNE})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = pruneAuditParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { older_than_days, include_applied, limit } = parsed.data

    const audit: any = container.resolve(OPS_AUDIT_MODULE)

    const cutoff = computePruneCutoff(new Date(), older_than_days)
    const filters: Record<string, unknown> = { created_at: { $lt: cutoff } }
    if (!include_applied) filters.applied = false

    const [rows] = await audit.listAndCountOpsMaintenanceRuns(filters, {
      take: limit,
      order: { created_at: "ASC" },
    })

    const matched: any[] = rows || []
    const changes: MaintenanceChange[] = matched.map((r) => ({
      entity: "ops_maintenance_run",
      id: r.id,
      field: "deleted",
      before: r.job_id,
      after: null,
    }))

    if (!dry_run && matched.length > 0) {
      await audit.deleteOpsMaintenanceRuns(matched.map((r) => r.id))
    }

    return {
      job_id: pruneOpsAuditRunsJob.id,
      dry_run,
      applied: !dry_run && matched.length > 0,
      summary: summarizeAuditPrune(dry_run, matched.length, older_than_days, include_applied),
      changes,
    }
  },
}

/**
 * Hard cap on the order-currency backfill scan. Bounds the per-request blast
 * radius (each call reads partner→order links + order rows and may write
 * order currency_code). Bigger sweeps raise `limit` across chunked calls.
 */
export const MAX_ORDER_CURRENCY_SCAN = 5000

const backfillOrderCurrencyParamsSchema = z.object({
  /** Restrict the sweep to a single partner instead of all partners. */
  partner_id: z.string().min(1).optional(),
  /**
   * Only re-stamp orders currently denominated in this currency. Defaults to
   * "eur" — the wrong platform-store currency that #485 stamped onto partner
   * work-orders. Lower-cased before matching.
   */
  from_currency: z.string().min(1).optional().default("eur"),
  /** Max unified orders to change in one call (1..MAX_ORDER_CURRENCY_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_ORDER_CURRENCY_SCAN)
    .optional()
    .default(1000),
})

/**
 * Pure: diff one unified order's currently-stored currency_code against the
 * target (the owning partner's store currency). Returns a single currency_code
 * change (or none when already equal, case-insensitively). Exported for unit
 * testing — keeps the dry-run/apply selection verifiable without the DB.
 */
export function diffOrderCurrency(
  orderId: string,
  before: string | null | undefined,
  after: string
): MaintenanceChange[] {
  const beforeNorm = before == null ? null : String(before).toLowerCase()
  const afterNorm = after.toLowerCase()
  if (beforeNorm === afterNorm) return []
  return [
    {
      entity: "order",
      id: orderId,
      field: "currency_code",
      before: beforeNorm,
      after: afterNorm,
    },
  ]
}

/**
 * Pure summary builder for the partner-order currency backfill — keeps the
 * human-facing string verifiable without booting the DB.
 */
export function summarizeOrderCurrencyBackfill(
  dryRun: boolean,
  partnersScanned: number,
  ordersScanned: number,
  changedCount: number,
  fromCurrency: string,
  errorCount: number
): string {
  const verb = dryRun ? "Would re-stamp" : "Re-stamped"
  const head =
    changedCount === 0
      ? `No changes — scanned ${ordersScanned} order(s) across ${partnersScanned} partner(s), none denominated in '${fromCurrency}' needed correction`
      : `${verb} currency on ${changedCount} order(s) (scanned ${ordersScanned} across ${partnersScanned} partner(s), from '${fromCurrency}')`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

/**
 * Backfill partner work-order currency (#485). On a multi-store deployment the
 * historical `stores[0]` pattern stamped the platform store currency (EUR) onto
 * every partner work-order / design reference instead of the partner's own
 * store currency (INR). This job, for each partner, resolves the correct store
 * currency (`resolveStoreCurrency`), reads that partner's unified orders via the
 * D3 partner↔order link, and re-stamps any order still denominated in
 * `from_currency` (default "eur") to the partner's store currency.
 *
 * This is a RELABEL, not a conversion: the amounts were entered in the partner's
 * native currency (INR) all along — only the persisted `currency_code` was
 * wrong (see apps/docs/notes/485_PARTNER_CURRENCY_EUR_ROOT_CAUSE.md). Dry-run
 * (default) previews every before→after without persisting; apply writes
 * `currency_code` via the order module (idempotent — re-running is a no-op once
 * currencies match). A partner whose own store currency equals `from_currency`
 * is skipped (nothing to correct). Bounded by `limit` changes per call.
 */
export const backfillPartnerOrderCurrencyJob: MaintenanceJob = {
  id: "backfill-partner-order-currency",
  label: "Backfill partner order currency",
  description:
    `Re-stamp partner work-order currency_code from the wrong platform-store currency (#485) to the owning partner's store currency. For each partner, resolves the partner store currency and re-labels their unified orders still denominated in 'from_currency' (default "eur"). This is a relabel, not an FX conversion — amounts were entered in the partner's native currency all along. Dry-run previews before/after without persisting; apply writes currency_code (idempotent). Optionally scope to one partner_id. Changes up to 'limit' orders per call (default 1000, max ${MAX_ORDER_CURRENCY_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the sweep to a single partner (default: all partners)",
    },
    {
      name: "from_currency",
      type: "string",
      required: false,
      description: 'Only re-stamp orders currently in this currency (default "eur")',
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max orders to change in one call (default 1000, max ${MAX_ORDER_CURRENCY_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillOrderCurrencyParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, from_currency, limit } = parsed.data
    const fromCurrency = from_currency.toLowerCase()

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderService: any = container.resolve(Modules.ORDER)

    // Target partners: a single id, or all partners (bounded — partners are few).
    let partnerIds: string[]
    if (partner_id) {
      partnerIds = [partner_id]
    } else {
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["id"],
        pagination: { take: MAX_ORDER_CURRENCY_SCAN },
      })
      partnerIds = (partners ?? []).map((p: any) => p?.id).filter(Boolean)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let partnersScanned = 0
    let ordersScanned = 0

    for (const pid of partnerIds) {
      if (changes.length >= limit) break
      partnersScanned++
      try {
        const targetCurrency = await resolveStoreCurrency(container, { partnerId: pid })
        // Partner's own currency equals the (wrong) source — nothing to fix.
        if (targetCurrency.toLowerCase() === fromCurrency) continue

        // Read the D3 partner↔order link table directly (source of truth) — the
        // `partner.orders` graph accessor pluralisation isn't guaranteed.
        const { data: linkRows } = await query.graph({
          entity: partnerOrderLink.entryPoint,
          fields: ["order_id"],
          filters: { partner_id: pid },
        })
        const orderIds: string[] = Array.from(
          new Set((linkRows ?? []).map((r: any) => r?.order_id).filter(Boolean))
        )
        if (!orderIds.length) continue

        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id", "currency_code"],
          filters: { id: orderIds, currency_code: fromCurrency },
        })

        for (const order of orders ?? []) {
          if (changes.length >= limit) break
          ordersScanned++
          const orderChanges = diffOrderCurrency(
            order.id,
            order.currency_code,
            targetCurrency
          )
          if (orderChanges.length === 0) continue

          changes.push(...orderChanges)

          if (!dry_run) {
            await orderService.updateOrders([
              { id: order.id, currency_code: targetCurrency },
            ])
          }
        }
      } catch (e: any) {
        errors.push({ id: pid, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillPartnerOrderCurrencyJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeOrderCurrencyBackfill(
        dry_run,
        partnersScanned,
        ordersScanned,
        changes.length,
        fromCurrency,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the partner-region link repair scan. Partners are few, but we
 * still bound the per-request blast radius (each partner reads its stores + the
 * `partner_region` link rows). Bigger fleets raise `limit` across chunked calls.
 */
export const MAX_PARTNER_REGION_SCAN = 5000

const repairPartnerRegionParamsSchema = z.object({
  /** Restrict the repair to a single partner instead of all partners. */
  partner_id: z.string().min(1).optional(),
  /** Max partners to scan in one call (1..MAX_PARTNER_REGION_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PARTNER_REGION_SCAN)
    .optional()
    .default(1000),
})

/**
 * Pure: compute the `partner_region` link repairs for ONE partner.
 *
 * The partner↔region link is the tenant source-of-truth — the partner regions
 * route has NO fallback to `store.default_region_id` ("if it isn't linked, the
 * partner doesn't own it"), so a missing link silently hides a partner's own
 * default region. Two safe, well-defined link-table corrections (no entity
 * writes):
 *   • ADD a missing link — the store points at an EXISTING `default_region_id`
 *     R but there's no (partner, R) `partner_region` row.
 *   • REMOVE an orphan link — a (partner, R) row whose region R no longer
 *     exists (a deleted region leaves a dangling pivot row).
 *
 * Cross-tenant "bleed" (a region linked to a partner that arguably shouldn't own
 * it) is deliberately NOT auto-repaired: there's no derivable ownership rule for
 * an arbitrary linked region, and partners legitimately copy/share regions
 * (feedback_partner_region_extend_not_lockdown), so removing it would risk
 * dropping a valid link. Only the two unambiguous cases above are corrected.
 *
 * Exported for unit testing — container-free.
 */
export function diffPartnerRegionLinks(
  partnerId: string,
  defaultRegionIds: string[],
  linkedRegionIds: string[],
  existingRegionIds: Set<string>
): MaintenanceChange[] {
  const linked = new Set(linkedRegionIds)
  const changes: MaintenanceChange[] = []

  // ADD: a store's default region exists but isn't linked to the partner.
  const addedSeen = new Set<string>()
  for (const regionId of defaultRegionIds) {
    if (!regionId || addedSeen.has(regionId)) continue
    if (!existingRegionIds.has(regionId)) continue // can't link a deleted region
    if (linked.has(regionId)) continue // already linked
    addedSeen.add(regionId)
    changes.push({
      entity: "partner_region",
      id: `${partnerId}:${regionId}`,
      field: "add_link",
      before: null,
      after: regionId,
    })
  }

  // REMOVE: a linked region no longer exists (orphan pivot row).
  const removedSeen = new Set<string>()
  for (const regionId of linkedRegionIds) {
    if (!regionId || removedSeen.has(regionId)) continue
    if (existingRegionIds.has(regionId)) continue // region exists — keep it
    removedSeen.add(regionId)
    changes.push({
      entity: "partner_region",
      id: `${partnerId}:${regionId}`,
      field: "remove_orphan_link",
      before: regionId,
      after: null,
    })
  }

  return changes
}

/**
 * Pure summary builder for the partner-region link repair — keeps the
 * human-facing string verifiable without booting the DB.
 */
export function summarizePartnerRegionRepair(
  dryRun: boolean,
  partnersScanned: number,
  addedCount: number,
  removedCount: number,
  errorCount: number
): string {
  if (addedCount === 0 && removedCount === 0) {
    return `No changes — scanned ${partnersScanned} partner(s), all partner_region links consistent`
  }
  const verb = dryRun ? "Would" : "Did"
  const parts: string[] = []
  if (addedCount > 0) parts.push(`add ${addedCount} missing link(s)`)
  if (removedCount > 0) parts.push(`remove ${removedCount} orphan link(s)`)
  const head = `${verb} ${parts.join(" and ")} across ${partnersScanned} partner(s)`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

/**
 * Repair partner_region links (#508 Data Plumbing v2 — tenant correctness). The
 * partner↔region link is the multi-tenant source-of-truth; this job adds the
 * missing (partner, default-region) link when a store's `default_region_id`
 * points at an existing region that isn't linked, and removes orphan links whose
 * region was deleted. Dry-run (default) previews every link it would add/remove
 * without writing; apply creates/dismisses via the remote link (idempotent —
 * re-running is a no-op once links are consistent). Pure link-table ops, no
 * entity writes. Optionally scope to one partner_id; a per-partner failure is
 * reported in `errors` instead of aborting the sweep.
 */
export const repairPartnerRegionLinksJob: MaintenanceJob = {
  id: "repair-partner-region-links",
  label: "Repair partner region links",
  description:
    `Repair the partner_region link table (tenant source-of-truth). Adds the missing link when a partner's store default_region_id points at an existing region with no link (the partner otherwise can't see its own default region), and removes orphan links whose region was deleted. Dry-run (default) previews every link it would add/remove without persisting; apply creates/dismisses the links (idempotent). Pure link-table ops, no entity writes. Optionally scope to one partner_id. Scans up to 'limit' partners per call (default 1000, max ${MAX_PARTNER_REGION_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the repair to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partners to scan in one call (default 1000, max ${MAX_PARTNER_REGION_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = repairPartnerRegionParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    // Target partners + their stores' default_region_id. Partners are few.
    const partnerGraphArgs: Record<string, unknown> = {
      entity: "partners",
      fields: ["id", "stores.default_region_id"],
      pagination: { take: limit },
    }
    if (partner_id) partnerGraphArgs.filters = { id: partner_id }
    const { data: partners } = await query.graph(partnerGraphArgs as any)
    const targetPartners = (partners ?? []).filter((p: any) => p?.id)

    // Existing partner_region links for the target partners.
    const partnerIds = targetPartners.map((p: any) => p.id)
    let linkRows: any[] = []
    if (partnerIds.length) {
      const { data: links } = await query.graph({
        entity: partnerRegionLink.entryPoint,
        fields: ["partner_id", "region_id"],
        filters: { partner_id: partnerIds },
      })
      linkRows = links ?? []
    }

    // Every region id referenced (default or linked) → which still exist.
    const referencedRegionIds = new Set<string>()
    for (const p of targetPartners) {
      for (const s of p.stores ?? []) {
        if (s?.default_region_id) referencedRegionIds.add(s.default_region_id)
      }
    }
    for (const l of linkRows) {
      if (l?.region_id) referencedRegionIds.add(l.region_id)
    }
    let existingRegionIds = new Set<string>()
    if (referencedRegionIds.size) {
      const { data: regions } = await query.graph({
        entity: "region",
        fields: ["id"],
        filters: { id: Array.from(referencedRegionIds) },
      })
      existingRegionIds = new Set((regions ?? []).map((r: any) => r.id))
    }

    // Index linked region ids by partner.
    const linkedByPartner = new Map<string, string[]>()
    for (const l of linkRows) {
      if (!l?.partner_id || !l?.region_id) continue
      const arr = linkedByPartner.get(l.partner_id) ?? []
      arr.push(l.region_id)
      linkedByPartner.set(l.partner_id, arr)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let added = 0
    let removed = 0

    for (const partner of targetPartners) {
      try {
        const defaultRegionIds = ((partner.stores ?? []) as any[])
          .map((s) => s?.default_region_id)
          .filter(Boolean) as string[]
        const linkedRegionIds = linkedByPartner.get(partner.id) ?? []

        const partnerChanges = diffPartnerRegionLinks(
          partner.id,
          defaultRegionIds,
          linkedRegionIds,
          existingRegionIds
        )
        if (!partnerChanges.length) continue

        for (const change of partnerChanges) {
          if (change.field === "add_link") {
            added++
            if (!dry_run) {
              await remoteLink.create({
                partner: { partner_id: partner.id },
                [Modules.REGION]: { region_id: change.after as string },
              })
            }
          } else if (change.field === "remove_orphan_link") {
            removed++
            if (!dry_run) {
              await remoteLink.dismiss({
                partner: { partner_id: partner.id },
                [Modules.REGION]: { region_id: change.before as string },
              })
            }
          }
        }
        changes.push(...partnerChanges)
      } catch (e: any) {
        errors.push({ id: partner.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: repairPartnerRegionLinksJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizePartnerRegionRepair(
        dry_run,
        targetPartners.length,
        added,
        removed,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the landing-URL resync scan. Each synced product runs the partner
 * pivot (several query.graph lookups) and, on apply, a live Google re-sync, so we
 * bound the per-request blast radius. Bigger sweeps raise `limit` across chunked
 * calls.
 */
export const MAX_RESYNC_SCAN = 5000

const resyncLandingParamsSchema = z.object({
  /** Restrict the resync to one Google Merchant account instead of all. */
  account_id: z.string().min(1).optional(),
  /** Max synced product links to scan in one call (1..MAX_RESYNC_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_RESYNC_SCAN)
    .optional()
    .default(1000),
})

/**
 * Pure: build the Google `link` (landing) URL for a product from a base + handle.
 * Mirrors the sync step's `${base}/products/${handle}` exactly (trailing slashes
 * stripped). Returns null when either input is missing. Exported for unit testing.
 */
export function buildProductLandingUrl(
  base: string | null | undefined,
  handle: string | null | undefined
): string | null {
  if (!base || !handle) return null
  return `${String(base).replace(/\/+$/, "")}/products/${handle}`
}

/**
 * Pure: detect a drifted Google landing URL for ONE synced product (#377 /
 * #508 slice 5).
 *
 * #377 made the Google `link` derive from the OWNING PARTNER storefront base
 * instead of a single global base (account `landing_url_base` → `STORE_URL`).
 * Products synced BEFORE that fix carry a stale link built from the global base.
 * Drift exists when the partner base resolves AND the URL it produces differs
 * from the URL the product is currently synced under (reconstructed from the
 * global base — the local link does NOT persist the URL, so for historical rows
 * the "before" is the best-effort global reconstruction).
 *
 * A product with NO partner owner correctly falls back to the global base — no
 * drift, nothing to fix. A missing handle can't produce a URL → no change.
 *
 * Exported for unit testing — container-free.
 */
export function diffProductLandingUrl(
  productId: string,
  handle: string | null | undefined,
  partnerBase: string | null,
  globalBase: string | null
): MaintenanceChange[] {
  // Not partner-owned → product is correctly on the global base; nothing to fix.
  if (!partnerBase) return []
  const after = buildProductLandingUrl(partnerBase, handle)
  if (!after) return [] // no handle → can't build / push a URL
  const before = buildProductLandingUrl(globalBase, handle)
  if (before === after) return []
  return [
    {
      entity: "product",
      id: productId,
      field: "google_landing_url",
      before,
      after,
    },
  ]
}

/**
 * Pure summary builder for the landing-URL resync — keeps the human-facing string
 * verifiable without booting the DB.
 */
export function summarizeLandingUrlResync(
  dryRun: boolean,
  scanned: number,
  changedCount: number,
  noPartnerCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would re-sync" : "Re-synced"
  const head =
    changedCount === 0
      ? `No changes — scanned ${scanned} synced product(s), none have a partner landing URL that drifted from their Google link`
      : `${verb} ${changedCount} product(s) whose Google landing URL drifted from the owning partner storefront base (scanned ${scanned})`
  const skips = noPartnerCount > 0 ? `; ${noPartnerCount} not partner-owned` : ""
  return errorCount > 0 ? `${head}${skips}; ${errorCount} error(s)` : `${head}${skips}`
}

/**
 * Resolve the pre-#377 "global" landing base for a Google Merchant account — the
 * base the product was previously synced under (account `api_config.landing_url_base`
 * → `STORE_URL`). Normalized to `https://<host>` so it compares apples-to-apples
 * with the partner base. Never throws (→ falls back to STORE_URL / null).
 */
async function resolveAccountGlobalBase(
  query: any,
  accountId: string
): Promise<string | null> {
  try {
    const { data } = await query.graph({
      entity: "google_merchant_account",
      fields: ["id", "api_config"],
      filters: { id: accountId },
    })
    const cfg = (data?.[0]?.api_config as any) || {}
    return (
      normalizeLandingBase(cfg?.landing_url_base) ||
      normalizeLandingBase(process.env.STORE_URL)
    )
  } catch {
    return normalizeLandingBase(process.env.STORE_URL)
  }
}

/**
 * Resync product partner landing URL (#508 Data Plumbing v2 — #377 denormalized
 * link drift). #377 made a product's Google `link` derive from the owning
 * partner storefront base; products synced before that carry a stale link built
 * from the global base. This job scans already-synced product→Google links,
 * resolves each product's partner storefront base (the never-throws #377
 * resolver), and flags those whose URL now differs from the global base they were
 * synced under.
 *
 * Dry-run (default) previews every old→new URL per product WITHOUT touching
 * Google. Apply re-runs the existing `syncProductToGoogleWorkflow` per drifted
 * product so Google receives the corrected partner link (the fix can only live on
 * Google — the local link does not persist the URL). A per-product failure
 * (e.g. externally-managed listing, auth error) is recorded in `errors` instead
 * of aborting the sweep. Optionally scope to one account_id.
 */
export const resyncProductLandingUrlJob: MaintenanceJob = {
  id: "resync-product-partner-landing-url",
  label: "Resync product partner landing URL",
  description:
    `Re-derive a synced product's Google landing URL from the owning partner storefront base (#377) and re-sync the ones that drifted. Dry-run (default) previews old→new URL per product without touching Google; apply re-runs the product sync so Google gets the corrected partner link. Only already-synced, partner-owned products are considered (non-partner products correctly use the global base). The "before" URL is reconstructed from the account/global base since the local link does not persist it. A per-product failure is reported, not fatal. Optionally scope to one account_id. Scans up to 'limit' synced links per call (default 1000, max ${MAX_RESYNC_SCAN}).`,
  params: [
    {
      name: "account_id",
      type: "string",
      required: false,
      description: "Restrict the resync to one Google Merchant account (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max synced product links to scan in one call (default 1000, max ${MAX_RESYNC_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = resyncLandingParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { account_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Synced product→Google links (a stale link only matters once it's live).
    const linkArgs: Record<string, unknown> = {
      entity: productGoogleMerchantLink.entryPoint,
      fields: ["product_id", "google_merchant_account_id", "sync_status"],
      pagination: { take: limit },
    }
    if (account_id) linkArgs.filters = { google_merchant_account_id: account_id }
    const { data: links } = await query.graph(linkArgs as any)
    const synced = (links ?? []).filter(
      (l: any) => l?.product_id && l?.sync_status === "synced"
    )

    // Batch-load product handles (avoid relying on a dot-path through the link).
    const productIds = Array.from(
      new Set(synced.map((l: any) => l.product_id))
    ) as string[]
    const handleById = new Map<string, string | null>()
    if (productIds.length) {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "handle"],
        filters: { id: productIds },
      })
      for (const p of products ?? []) handleById.set(p.id, p.handle ?? null)
    }

    const accountBaseCache = new Map<string, string | null>()
    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let noPartner = 0

    for (const link of synced) {
      const productId = link.product_id as string
      const accountId = link.google_merchant_account_id as string
      try {
        const partnerBase = await resolvePartnerLandingBase(query, productId)
        if (!partnerBase) {
          noPartner++
          continue
        }

        if (!accountBaseCache.has(accountId)) {
          accountBaseCache.set(
            accountId,
            await resolveAccountGlobalBase(query, accountId)
          )
        }
        const globalBase = accountBaseCache.get(accountId) ?? null

        const drift = diffProductLandingUrl(
          productId,
          handleById.get(productId),
          partnerBase,
          globalBase
        )
        if (!drift.length) continue

        changes.push(...drift)

        if (!dry_run) {
          await syncProductToGoogleWorkflow(container).run({
            input: { product_id: productId, account_id: accountId },
          })
        }
      } catch (e: any) {
        errors.push({ id: productId, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: resyncProductLandingUrlJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeLandingUrlResync(
        dry_run,
        synced.length,
        changes.length,
        noPartner,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the consumption-log production_run_id backfill scan. Each scanned
 * link row drives a consumption_log read (batched) + at most one column write, so
 * we bound the per-request blast radius. Bigger sweeps raise `limit` across
 * chunked calls.
 */
export const MAX_CONSUMPTION_BACKFILL_SCAN = 5000

const backfillConsumptionRunIdParamsSchema = z.object({
  /** Restrict the backfill to logs linked to one production run. */
  production_run_id: z.string().min(1).optional(),
  /** Max production_run↔consumption_log links to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_CONSUMPTION_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

export type ConsumptionBackfillDecision =
  | "already_set"
  | "no_link"
  | "filled"
  | "ambiguous"

/**
 * Pure: decide the production_run_id backfill for ONE consumption log (#508
 * slice 6 — `backfill-consumption-log-production-run-id`).
 *
 * `consumption_log.production_run_id` is a DENORMALIZED copy of the
 * production_runs↔consumption_log module link — and it is the PRIMARY read path
 * (the run cost-summary route filters logs by this column, not by the link). The
 * link is created best-effort in `log-consumption.ts` (its `remoteLink.create`
 * is wrapped in a swallow-all try/catch), and the column itself was added by an
 * ALTER (see migration-hazard memory), so a log can end up LINKED to a run while
 * its column is still null → cost-summary silently undercounts that log.
 *
 * A backfill is unambiguous ONLY when the link points at exactly one run:
 *   • already set      → no change (never overwrite an existing value)
 *   • no linked run    → skip (sample/energy/labor logs legitimately have no run
 *                        forever — a null column is correct, not drift)
 *   • exactly one run  → fill the column from the link
 *   • multiple runs    → ambiguous; skip (can't pick one safely)
 *
 * Exported for unit testing — container-free.
 */
export function diffConsumptionLogProductionRunId(
  logId: string,
  currentProductionRunId: string | null | undefined,
  linkedProductionRunIds: string[]
): { decision: ConsumptionBackfillDecision; changes: MaintenanceChange[] } {
  if (currentProductionRunId) {
    return { decision: "already_set", changes: [] }
  }
  const unique = Array.from(
    new Set((linkedProductionRunIds ?? []).filter(Boolean))
  )
  if (unique.length === 0) return { decision: "no_link", changes: [] }
  if (unique.length > 1) return { decision: "ambiguous", changes: [] }
  return {
    decision: "filled",
    changes: [
      {
        entity: "consumption_log",
        id: logId,
        field: "production_run_id",
        before: null,
        after: unique[0],
      },
    ],
  }
}

/**
 * Pure summary builder for the consumption-log backfill — keeps the human-facing
 * string verifiable without booting the DB. Ambiguous (multi-run) logs are a skip
 * surfaced separately, not a processing error (mirrors the landing-URL job's
 * "not partner-owned" skip clause).
 */
export function summarizeConsumptionLogBackfill(
  dryRun: boolean,
  scanned: number,
  filledCount: number,
  ambiguousCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would backfill" : "Backfilled"
  const head =
    filledCount === 0
      ? `No changes — scanned ${scanned} linked consumption log(s), none need a production_run_id backfill`
      : `${verb} production_run_id on ${filledCount} consumption log(s) from their production-run link (scanned ${scanned})`
  const amb =
    ambiguousCount > 0
      ? `; ${ambiguousCount} ambiguous (linked to multiple runs) skipped`
      : ""
  return errorCount > 0 ? `${head}${amb}; ${errorCount} error(s)` : `${head}${amb}`
}

/**
 * Backfill consumption_log.production_run_id (#508 Data Plumbing v2 — ALTER-added
 * denormalized FK with historical nulls). The production_run↔consumption_log link
 * is the source of truth; this job fills the column for logs that are linked to
 * exactly one run but whose column is still null (so the run cost-summary, which
 * reads the column, stops undercounting them). Dry-run (default) previews every
 * null→run-id it would set without writing; apply persists the column and NEVER
 * overwrites an existing value (idempotent — re-running is a no-op once filled).
 * Logs with no link (samples/energy/labor) are left alone; logs linked to
 * multiple runs are skipped as ambiguous. A per-log failure is reported in
 * `errors` instead of aborting the sweep. Optionally scope to one production_run_id.
 */
export const backfillConsumptionLogProductionRunIdJob: MaintenanceJob = {
  id: "backfill-consumption-log-production-run-id",
  label: "Backfill consumption log production run id",
  description:
    `Backfill the denormalized consumption_log.production_run_id column from the production-run↔consumption-log link (the run cost-summary reads this column, not the link, so a missing value silently undercounts run costs). Only logs LINKED to exactly one production run whose column is still null are filled; logs with no link (samples/energy/labor) are left alone and logs linked to multiple runs are skipped as ambiguous. Dry-run (default) previews every null→run-id it would set without writing; apply persists the column and never overwrites an existing value (idempotent). Optionally scope to one production_run_id. Scans up to 'limit' links per call (default 1000, max ${MAX_CONSUMPTION_BACKFILL_SCAN}).`,
  params: [
    {
      name: "production_run_id",
      type: "string",
      required: false,
      description:
        "Restrict the backfill to logs linked to one production run (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max production-run links to scan in one call (default 1000, max ${MAX_CONSUMPTION_BACKFILL_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillConsumptionRunIdParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { production_run_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const consumptionLogService: any = container.resolve(CONSUMPTION_LOG_MODULE)

    // The production_run↔consumption_log link is the source of truth; the column
    // is its denormalized copy. Only LINKED logs can ever need a backfill, so we
    // scan from the link table (far smaller than all null-column logs, which are
    // mostly samples that legitimately never carry a run).
    const linkArgs: Record<string, unknown> = {
      entity: productionRunConsumptionLogLink.entryPoint,
      fields: ["production_runs_id", "consumption_log_id"],
      pagination: { take: limit },
    }
    if (production_run_id) {
      linkArgs.filters = { production_runs_id: production_run_id }
    }
    const { data: links } = await query.graph(linkArgs as any)
    const linkRows = (links ?? []).filter(
      (l: any) => l?.consumption_log_id && l?.production_runs_id
    )

    // Index runs by consumption log (a log may, abnormally, be linked to >1 run).
    const runsByLog = new Map<string, string[]>()
    for (const l of linkRows) {
      const arr = runsByLog.get(l.consumption_log_id) ?? []
      arr.push(l.production_runs_id)
      runsByLog.set(l.consumption_log_id, arr)
    }

    // Batch-load the current column value for the linked logs.
    const logIds = Array.from(runsByLog.keys())
    const currentRunIdByLog = new Map<string, string | null>()
    if (logIds.length) {
      const { data: logs } = await query.graph({
        entity: "consumption_log",
        fields: ["id", "production_run_id"],
        filters: { id: logIds },
      })
      for (const log of logs ?? []) {
        currentRunIdByLog.set(log.id, log.production_run_id ?? null)
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let filled = 0
    let ambiguous = 0

    for (const logId of logIds) {
      try {
        // A linked log that no longer exists is just skipped (stale link row).
        if (!currentRunIdByLog.has(logId)) continue

        const { decision, changes: logChanges } =
          diffConsumptionLogProductionRunId(
            logId,
            currentRunIdByLog.get(logId),
            runsByLog.get(logId) ?? []
          )

        if (decision === "ambiguous") {
          ambiguous++
          continue
        }
        if (!logChanges.length) continue

        filled++
        if (!dry_run) {
          await consumptionLogService.updateConsumptionLogs({
            id: logId,
            production_run_id: logChanges[0].after as string,
          })
        }
        changes.push(...logChanges)
      } catch (e: any) {
        errors.push({ id: logId, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillConsumptionLogProductionRunIdJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeConsumptionLogBackfill(
        dry_run,
        logIds.length,
        filled,
        ambiguous,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the raw-material link-repair scan. Each call enumerates the
 * `inventory_item_raw_materials` pivot rows and resolves which inventory items /
 * raw materials still exist, so we bound the per-request blast radius. Bigger
 * sweeps raise the `limit` param across chunked calls.
 */
export const MAX_RAW_MATERIAL_LINK_SCAN = 10000

const repairRawMaterialLinkParamsSchema = z.object({
  /** Max pivot rows to scan in one call (1..MAX_RAW_MATERIAL_LINK_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_RAW_MATERIAL_LINK_SCAN)
    .optional()
    .default(2000),
})

/** Shape of one `inventory_item_raw_materials` pivot row, as queried. */
export type RawMaterialLinkRow = {
  inventory_item_id?: string | null
  raw_materials_id?: string | null
}

/**
 * Pure: compute the orphan `inventory_item_raw_materials` link removals.
 *
 * The inventory-item ↔ raw-material link is what the cost machinery walks
 * (`backfill-inventory-unit-cost`, `estimate-design-cost`) to resolve a unit's
 * raw material — `query.graph(... raw_materials.* )[0]`. When either side of a
 * pivot row is hard-deleted, the row dangles: the join silently resolves to a
 * null/missing entity, so `[0]` can land on a dead row and the cost lookup
 * misbehaves (silently skipped, or worse, the wrong row wins). This is the
 * inventory analogue of `repair-partner-region-links`.
 *
 * The ONLY safe, well-defined correction is removing a pivot row whose
 * inventory item OR raw material no longer exists. There is no derivable
 * "should-exist" rule to ADD a missing link (unlike the region job's
 * store.default_region_id source), so this job is orphan-removal only. Exact
 * duplicate (inventory_item, raw_material) rows can't exist — the link carries a
 * composite PK — so duplicate-collapse is a non-case.
 *
 * A row is flagged when its inventory_item_id is absent from
 * `existingInventoryItemIds` OR its raw_materials_id is absent from
 * `existingRawMaterialIds`. The `before.missing` tag records which side
 * (inventory_item | raw_material | both) is gone. Malformed rows missing either
 * id are skipped (can't be safely dismissed). De-duplicated by pivot pair so a
 * pair is reported once.
 *
 * Exported for unit testing — container-free.
 */
export function diffInventoryRawMaterialLinks(
  linkRows: RawMaterialLinkRow[],
  existingInventoryItemIds: Set<string>,
  existingRawMaterialIds: Set<string>
): MaintenanceChange[] {
  const changes: MaintenanceChange[] = []
  const seen = new Set<string>()

  for (const row of linkRows) {
    const invId = row?.inventory_item_id
    const rmId = row?.raw_materials_id
    if (!invId || !rmId) continue // malformed pivot row — can't safely dismiss

    const pairKey = `${invId}:${rmId}`
    if (seen.has(pairKey)) continue
    seen.add(pairKey)

    const invMissing = !existingInventoryItemIds.has(invId)
    const rmMissing = !existingRawMaterialIds.has(rmId)
    if (!invMissing && !rmMissing) continue // both sides live — keep the link

    const missing = invMissing && rmMissing ? "both" : invMissing ? "inventory_item" : "raw_material"
    changes.push({
      entity: "inventory_item_raw_materials",
      id: pairKey,
      field: "remove_orphan_link",
      before: { inventory_item_id: invId, raw_materials_id: rmId, missing },
      after: null,
    })
  }

  return changes
}

/**
 * Pure summary builder for the raw-material link repair — keeps the human-facing
 * string verifiable without booting the DB.
 */
export function summarizeRawMaterialLinkRepair(
  dryRun: boolean,
  rowsScanned: number,
  removedCount: number,
  errorCount: number
): string {
  const head =
    removedCount === 0
      ? `No changes — scanned ${rowsScanned} inventory↔raw-material link(s), none orphaned`
      : `${dryRun ? "Would" : "Did"} remove ${removedCount} orphan link(s) whose inventory item or raw material no longer exists (scanned ${rowsScanned})`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

/**
 * Repair inventory-item ↔ raw-material links (#508 Data Plumbing v2 — cost-path
 * integrity). The `inventory_item_raw_materials` pivot is what the unit-cost
 * backfill and design-cost estimator walk to resolve a unit's raw material; a
 * pivot row whose inventory item or raw material was hard-deleted dangles and
 * can corrupt that lookup. This job enumerates the pivot rows, resolves which
 * inventory items / raw materials still exist, and removes the orphans. Dry-run
 * (default) previews every link it would remove without writing; apply dismisses
 * them via the remote link (idempotent — re-running is a no-op once clean). Pure
 * link-table ops, no entity writes. A per-link dismiss failure is reported in
 * `errors` instead of aborting the sweep.
 *
 * NOTE: existence is checked via the module list (soft-deleted rows are excluded
 * by default), so a SOFT-deleted inventory item / raw material reads as "gone"
 * and its links are flagged — mirrors `repair-partner-region-links`. Restore the
 * entity before running if you intend to keep its links.
 */
export const repairInventoryRawMaterialLinksJob: MaintenanceJob = {
  id: "repair-inventory-raw-material-links",
  label: "Repair inventory ↔ raw-material links",
  description:
    `Remove orphan inventory_item_raw_materials pivot rows whose inventory item or raw material no longer exists — the cost machinery (unit-cost backfill, design-cost estimator) walks this link, and a dangling row corrupts the lookup. Dry-run (default) previews every link it would remove without persisting; apply dismisses them (idempotent). Pure link-table ops, no entity writes. Scans up to 'limit' pivot rows per call (default 2000, max ${MAX_RAW_MATERIAL_LINK_SCAN}).`,
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max pivot rows to scan in one call (default 2000, max ${MAX_RAW_MATERIAL_LINK_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = repairRawMaterialLinkParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    const inventoryService: any = container.resolve(Modules.INVENTORY)
    const rawMaterialService: any = container.resolve(RAW_MATERIAL_MODULE)

    // Enumerate the pivot rows (just the two foreign keys).
    const { data: rawRows } = await query.graph({
      entity: "inventory_item_raw_materials",
      fields: ["inventory_item_id", "raw_materials_id"],
      pagination: { take: limit },
    })
    const linkRows: RawMaterialLinkRow[] = rawRows ?? []

    const invIds = Array.from(
      new Set(linkRows.map((r) => r.inventory_item_id).filter(Boolean) as string[])
    )
    const rmIds = Array.from(
      new Set(linkRows.map((r) => r.raw_materials_id).filter(Boolean) as string[])
    )

    // Which referenced inventory items / raw materials still exist.
    let existingInventoryItemIds = new Set<string>()
    if (invIds.length) {
      const items: any[] = await inventoryService.listInventoryItems(
        { id: invIds },
        { take: invIds.length, select: ["id"] }
      )
      existingInventoryItemIds = new Set(items.map((i) => i.id))
    }
    let existingRawMaterialIds = new Set<string>()
    if (rmIds.length) {
      const rms: any[] = await rawMaterialService.listRawMaterials(
        { id: rmIds },
        { take: rmIds.length, select: ["id"] }
      )
      existingRawMaterialIds = new Set(rms.map((r) => r.id))
    }

    const changes = diffInventoryRawMaterialLinks(
      linkRows,
      existingInventoryItemIds,
      existingRawMaterialIds
    )

    let removed = 0
    const errors: Array<{ id: string; message: string }> = []
    for (const change of changes) {
      const before = change.before as {
        inventory_item_id: string
        raw_materials_id: string
      }
      if (dry_run) {
        removed++
        continue
      }
      try {
        await remoteLink.dismiss({
          [Modules.INVENTORY]: { inventory_item_id: before.inventory_item_id },
          [RAW_MATERIAL_MODULE]: { raw_materials_id: before.raw_materials_id },
        })
        removed++
      } catch (e: any) {
        errors.push({ id: change.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: repairInventoryRawMaterialLinksJob.id,
      dry_run,
      applied: !dry_run && removed > 0,
      summary: summarizeRawMaterialLinkRepair(
        dry_run,
        linkRows.length,
        removed,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the historical partner-fee backfill scan. Partners are few; we
 * still bound the per-request blast radius (each partner reads its order-link
 * rows + each order's total). Bigger fleets raise `limit` across chunked calls.
 */
export const MAX_PARTNER_FEE_BACKFILL_SCAN = 5000

const backfillPartnerOrderFeesParamsSchema = z.object({
  /** Restrict the backfill to a single partner instead of all partners. */
  partner_id: z.string().min(1).optional(),
  /** Max fees to accrue in one call (1..MAX_PARTNER_FEE_BACKFILL_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PARTNER_FEE_BACKFILL_SCAN)
    .optional()
    .default(1000),
})

/**
 * Pure: should a partner-linked order get a commission fee accrued by the
 * historical backfill?
 *
 * The Slice 2 subscriber accrues at `order.placed` and Slice 3 reverses at
 * `order.canceled`. For a historical order the net outcome must match:
 *   - already has a `partner_fee` row → skip (idempotent; the subscriber or a
 *     prior backfill run already handled it).
 *   - order is `canceled` → skip: had the subscriber existed, the fee would
 *     have been accrued then reversed (net zero), so accruing-and-leaving it
 *     `accrued` would over-count the partner's net commission.
 *   - otherwise → accrue.
 *
 * Exported for unit testing — keeps the dry-run/apply selection verifiable
 * without booting the DB.
 */
export function shouldBackfillOrderFee(
  existingFee: unknown,
  orderStatus: string | null | undefined
): boolean {
  if (existingFee) return false
  if (String(orderStatus || "").toLowerCase() === "canceled") return false
  return true
}

/**
 * Pure summary builder for the historical partner-fee backfill — keeps the
 * human-facing string verifiable without booting the DB.
 */
export function summarizePartnerFeeBackfill(
  dryRun: boolean,
  partnersScanned: number,
  ordersScanned: number,
  accruedCount: number,
  errorCount: number
): string {
  const verb = dryRun ? "Would accrue" : "Accrued"
  const head =
    accruedCount === 0
      ? `No changes — scanned ${ordersScanned} partner order(s) across ${partnersScanned} partner(s), all already accrued or not eligible`
      : `${verb} ${accruedCount} commission fee(s) (scanned ${ordersScanned} order(s) across ${partnersScanned} partner(s))`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

/**
 * Backfill historical partner commission fees (#336 Slice 5). The Slice 2
 * subscriber only accrues `partner_fee` rows for orders placed AFTER it shipped;
 * partner-linked orders that predate it have no commission row. This job, for
 * each partner (or one `partner_id`), reads that partner's unified orders via
 * the D3 partner↔order link and accrues ONE `partner_fee` row per eligible order
 * using the SAME math as the subscriber (`resolvePartnerFeeRate` → `computeFee`,
 * default 2% — `PLATFORM_TX_FEE_BPS=200`), in the order's own `currency_code`.
 *
 * Idempotent + safe: orders that already have a fee are skipped
 * (`findFeeForOrder`), and `canceled` orders are skipped (the subscriber would
 * have accrued then reversed them → net zero). Dry-run (default) previews every
 * fee it would accrue without writing; apply creates the rows. A per-partner
 * failure is recorded in `errors` instead of aborting the sweep. Bounded by
 * `limit` accruals per call.
 */
export const backfillPartnerOrderFeesJob: MaintenanceJob = {
  id: "backfill-partner-order-fees",
  label: "Backfill partner order fees",
  description:
    `Accrue platform commission fees for historical partner-linked orders that predate the order.placed fee subscriber (#336). For each partner, reads their unified orders via the D3 partner↔order link and accrues one partner_fee row per eligible order using the same math as the live subscriber (default 2% — PLATFORM_TX_FEE_BPS), in the order's own currency_code. Idempotent: orders that already have a fee are skipped; canceled orders are skipped (would have netted to zero). Dry-run (default) previews every fee it would accrue; apply creates the rows. Optionally scope to one partner_id. Accrues up to 'limit' fees per call (default 1000, max ${MAX_PARTNER_FEE_BACKFILL_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the backfill to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max fees to accrue in one call (default 1000, max ${MAX_PARTNER_FEE_BACKFILL_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillPartnerOrderFeesParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderService: any = container.resolve(Modules.ORDER)
    const billingService: any = container.resolve(PARTNER_BILLING_MODULE)

    // Target partners: a single id, or all partners (bounded — partners are few).
    let partnerIds: string[]
    if (partner_id) {
      partnerIds = [partner_id]
    } else {
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["id"],
        pagination: { take: MAX_PARTNER_FEE_BACKFILL_SCAN },
      })
      partnerIds = (partners ?? []).map((p: any) => p?.id).filter(Boolean)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let partnersScanned = 0
    let ordersScanned = 0

    for (const pid of partnerIds) {
      if (changes.length >= limit) break
      partnersScanned++
      try {
        const { fee_basis, fee_rate } = await resolvePartnerFeeRate(container, {
          partnerId: pid,
        })

        // Read the D3 partner↔order link table directly (source of truth).
        const { data: linkRows } = await query.graph({
          entity: partnerOrderLink.entryPoint,
          fields: ["order_id"],
          filters: { partner_id: pid },
        })
        const orderIds: string[] = Array.from(
          new Set((linkRows ?? []).map((r: any) => r?.order_id).filter(Boolean))
        )
        if (!orderIds.length) continue

        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id", "total", "currency_code", "status"],
          filters: { id: orderIds },
        })

        for (const order of orders ?? []) {
          if (changes.length >= limit) break
          ordersScanned++

          const existing = await billingService.findFeeForOrder(order.id)
          if (!shouldBackfillOrderFee(existing, order.status)) continue

          const orderTotal = Number(order?.total)
          const currencyCode: string = order?.currency_code || ""
          const feeAmount = computeFee(orderTotal, fee_basis, fee_rate)

          changes.push({
            entity: "partner_fee",
            id: order.id,
            field: "accrue_fee",
            before: null,
            after: { partner_id: pid, fee_amount: feeAmount, currency_code: currencyCode },
          })

          if (!dry_run) {
            await billingService.createPartnerFees([
              {
                partner_id: pid,
                order_id: order.id,
                order_total: Number.isFinite(orderTotal) ? orderTotal : 0,
                currency_code: currencyCode,
                fee_basis,
                fee_rate,
                fee_amount: feeAmount,
                status: "accrued",
                accrued_at: new Date(),
                metadata: { source: "backfill-partner-order-fees" },
              },
            ])
          }
        }
      } catch (e: any) {
        errors.push({ id: pid, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillPartnerOrderFeesJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizePartnerFeeBackfill(
        dry_run,
        partnersScanned,
        ordersScanned,
        changes.length,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on how many stats panels a single window-backfill scan inspects.
 * Bounds blast radius; there are only a handful of dashboards in practice.
 */
export const MAX_STATS_PANEL_SCAN = 2000

const backfillStatsPanelWindowParamsSchema = z.object({
  /** Restrict to a single panel id (targeted mode — skips the aggregate-field filter). */
  panel_id: z.string().min(1).optional(),
  /** Relative window to apply, in days (default 30 — matches the seed). */
  last_days: z.number().int().positive().max(3650).optional().default(30),
  /** Date column the window filters on (default "date" — analytics_daily_stats). */
  date_field: z.string().min(1).optional().default("date"),
  /**
   * Scan-mode only: only patch aggregate_data panels whose aggregate.field
   * matches this (default "unique_visitors" — the #522 panel). Ignored when
   * panel_id is given (targeted mode patches that exact panel).
   */
  field: z.string().min(1).optional().default("unique_visitors"),
})

/**
 * Pure: decide whether a single stats panel needs a relative date window added
 * to its `operation_options`, and compute the patched options.
 *
 * Only `aggregate_data` panels qualify (time_series already carries its own
 * `range`). A panel is patched ONLY when it is missing a `range` — we never
 * clobber an intentional existing window, which makes the job idempotent
 * (re-running after a fix matches nothing). In scan mode the panel's
 * `aggregate.field` must equal `field`; targeted mode (an explicit panel_id)
 * skips that filter. Exported for unit testing — no DB needed.
 */
export function diffStatsPanelWindow(
  panel: {
    id: string
    operation_type?: string | null
    operation_options?: Record<string, any> | null
  },
  opts: { dateField: string; lastDays: number; field?: string; targeted: boolean }
): MaintenanceChange | null {
  if (panel.operation_type !== "aggregate_data") return null

  const options: Record<string, any> = { ...(panel.operation_options ?? {}) }

  // Already windowed → idempotent no-op (don't overwrite intentional config).
  if (options.range != null) return null

  // Scan mode only patches panels aggregating the target field.
  if (!opts.targeted && options?.aggregate?.field !== opts.field) return null

  const after: Record<string, any> = {
    ...options,
    dateField: options.dateField ?? opts.dateField,
    range: { last_days: opts.lastDays },
  }

  return {
    entity: "stats_panel",
    id: panel.id,
    field: "operation_options",
    before: options,
    after,
  }
}

/**
 * Pure human-facing summary for the stats-panel window backfill. Verifiable
 * without booting the DB.
 */
export function summarizeStatsPanelWindowBackfill(
  dryRun: boolean,
  scanned: number,
  changed: number,
  lastDays: number
): string {
  if (changed === 0) {
    return `No changes — all ${scanned} scanned panel(s) already carry a date window`
  }
  const verb = dryRun ? "Would add" : "Added"
  return `${verb} a ${lastDays}-day window to ${changed} of ${scanned} scanned stats panel(s)`
}

/**
 * Patch existing stats panels whose `aggregate_data` metric is missing a
 * relative date window (#522). The code fix (PR #543) taught `aggregate_data`
 * to honour `range`/`dateField`, and the seed now ships the Unique-visitors
 * panel with `dateField:"date"` + `range:{last_days:30}` — but the seed SKIPS
 * existing dashboards, so live panel rows created before the fix still sum
 * all-time. This job is the targeted, idempotent correction for those rows.
 *
 * Safe by default: dry-run (default) previews the exact operation_options diff
 * per panel; apply writes `operation_options`. Idempotent — a panel that
 * already has a `range` is never touched, so a re-run matches nothing.
 */
export const backfillStatsPanelWindowJob: MaintenanceJob = {
  id: "backfill-stats-panel-window",
  label: "Backfill stats panel date window",
  description:
    "Add a relative date window (dateField + range.last_days) to existing aggregate_data stats panels that are missing one — fixes metric panels (e.g. 'Unique visitors (30 days)', #522) that sum all-time because the seed skipped existing dashboards. Dry-run (default) previews the operation_options diff per panel; apply writes it. Idempotent: panels that already have a range are skipped. Scan mode targets panels aggregating 'field' (default unique_visitors); pass panel_id to patch one specific panel.",
  params: [
    {
      name: "panel_id",
      type: "string",
      required: false,
      description:
        "Patch only this panel (targeted mode — skips the aggregate-field filter). Omit to scan all aggregate_data panels.",
    },
    {
      name: "last_days",
      type: "number",
      required: false,
      description: "Window size in days to apply (default 30)",
    },
    {
      name: "date_field",
      type: "string",
      required: false,
      description: "Date column the window filters on (default 'date')",
    },
    {
      name: "field",
      type: "string",
      required: false,
      description:
        "Scan mode only: only patch panels whose aggregate.field matches this (default 'unique_visitors')",
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = backfillStatsPanelWindowParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { panel_id, last_days, date_field, field } = parsed.data
    const targeted = !!panel_id

    const stats: any = container.resolve(STATS_MODULE)

    const filters: Record<string, unknown> = targeted
      ? { id: panel_id }
      : { operation_type: "aggregate_data" }

    const [panels] = await stats.listAndCountStatsPanels(filters, {
      take: MAX_STATS_PANEL_SCAN,
    })

    const scanned: any[] = panels || []

    if (targeted && scanned.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Stats panel '${panel_id}' not found`
      )
    }

    const changes: MaintenanceChange[] = []
    for (const panel of scanned) {
      const change = diffStatsPanelWindow(panel, {
        dateField: date_field,
        lastDays: last_days,
        field,
        targeted,
      })
      if (change) changes.push(change)
    }

    if (!dry_run && changes.length > 0) {
      for (const change of changes) {
        await stats.updateStatsPanels({
          id: change.id,
          operation_options: change.after,
        })
      }
    }

    return {
      job_id: backfillStatsPanelWindowJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeStatsPanelWindowBackfill(
        dry_run,
        scanned.length,
        changes.length,
        last_days
      ),
      changes,
    }
  },
}

/** Hard cap on how many person-less purchase conversions one run repairs. */
export const MAX_ORDER_PERSON_BACKFILL = 1000

const backfillOrderPersonsParamsSchema = z.object({
  /** Max conversions to repair this run (default 200, capped to MAX_ORDER_PERSON_BACKFILL). */
  limit: z.number().int().positive().max(MAX_ORDER_PERSON_BACKFILL).optional().default(200),
  /** Restrict to a single order's purchase conversion(s) (targeted repair). */
  order_id: z.string().min(1).optional(),
})

export type OrderPersonBackfillDecision =
  | { action: "skip"; reason: string }
  | { action: "link"; person_id: string }
  | { action: "create" }

/**
 * Pure: decide what to do with one person-less purchase conversion (#664).
 *
 *   - already has person_id        → skip (idempotent; a re-run matches nothing)
 *   - no order_id / no usable email → skip (nothing to key a Person on)
 *   - email matches a Person        → link to it
 *   - otherwise                     → create a Person, then link
 *
 * `existingPersonId` is the id of a Person already matching the order email
 * (looked up by the caller, OR resolved within this run for a repeat email),
 * or null. Exported for unit testing — no DB needed.
 */
export function decideOrderPersonBackfill(input: {
  conversion: { person_id?: string | null; order_id?: string | null }
  email: string | null
  existingPersonId: string | null
}): OrderPersonBackfillDecision {
  if (input.conversion.person_id) return { action: "skip", reason: "already linked" }
  if (!input.conversion.order_id) return { action: "skip", reason: "no order_id" }
  if (!isUsableEmail(input.email)) return { action: "skip", reason: "no usable email" }
  if (input.existingPersonId) return { action: "link", person_id: input.existingPersonId }
  return { action: "create" }
}

/** Pure human-facing summary for the order→person backfill. */
export function summarizeOrderPersonBackfill(
  dryRun: boolean,
  scanned: number,
  linked: number,
  created: number,
  errored: number
): string {
  const repaired = linked + created
  if (repaired === 0) {
    return `No changes — none of the ${scanned} scanned person-less conversion(s) could be matched to an order email${errored ? ` (${errored} errored)` : ""}`
  }
  const verb = dryRun ? "Would repair" : "Repaired"
  return `${verb} ${repaired} of ${scanned} person-less conversion(s): ${dryRun ? "would link" : "linked"} ${linked} to existing Persons, ${dryRun ? "would create" : "created"} ${created} new Person(s)${errored ? `; ${errored} errored` : ""}`
}

/**
 * Backfill the `person_id` on historical purchase conversions that were tracked
 * before the order→Person upsert fix (#664). Manual orders had no matching
 * Person, so ad-planning stored `person_id: null` and all scoring (CLV / churn /
 * engagement) silently skipped — which also makes those buyers invisible to the
 * AI-VP winback targeting (which joins on CustomerScore.person_id).
 *
 * This repairs IDENTITY only: it upserts a Person from each order's email + name
 * and stamps `conversion.person_id`. Re-running the score recalculation over the
 * repaired rows is a separate follow-up (the live workflow scores all NEW orders).
 *
 * Safe by default: dry-run (default) previews the exact person_id stamps without
 * writing; apply upserts Persons + updates conversions. Idempotent — a conversion
 * that already has a person_id is never re-touched, so a re-run matches nothing.
 */
export const backfillOrderPersonsJob: MaintenanceJob = {
  id: "backfill-order-persons",
  label: "Backfill order → Person on conversions",
  description:
    "Upsert a Person (by order email + name) and stamp person_id onto historical purchase conversions that have none (#664 — manual orders were never scored). Dry-run previews the stamps; apply writes them. Idempotent and capped; re-run to continue past the limit.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max conversions to repair this run (default 200, max ${MAX_ORDER_PERSON_BACKFILL}).`,
    },
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Restrict to a single order's purchase conversion(s).",
    },
  ],
  run: async (container, { dry_run, params }) => {
    const { limit, order_id } = backfillOrderPersonsParamsSchema.parse(params ?? {})

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const adPlanning: any = container.resolve(AD_PLANNING_MODULE)
    const personService: any = container.resolve(PERSON_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let linked = 0
    let created = 0

    // Candidate conversions: purchases with no person_id (optionally one order).
    const convFilter: Record<string, unknown> = {
      conversion_type: "purchase",
      person_id: null,
    }
    if (order_id) convFilter.order_id = order_id

    const candidates: any[] = await adPlanning.listConversions(convFilter, {
      take: limit,
      order: { converted_at: "ASC" },
    })

    // Within one run a repeat email must resolve to a single Person (avoid dup
    // creates). Maps lowercased email → resolved-or-pending person id.
    const emailToPersonId = new Map<string, string>()

    for (const conv of candidates) {
      if (changes.length >= limit) break
      try {
        // Resolve the order's email + name.
        const { data: [order] } = await query.graph({
          entity: "order",
          fields: [
            "id",
            "email",
            "billing_address.first_name",
            "billing_address.last_name",
            "shipping_address.first_name",
            "shipping_address.last_name",
            "customer.first_name",
            "customer.last_name",
          ],
          filters: { id: conv.order_id },
        })

        const email: string | null = order?.email ?? null
        const emailKey = email ? email.trim().toLowerCase() : null

        // Has this email already been matched/created earlier in the run?
        let existingPersonId: string | null =
          emailKey && emailToPersonId.has(emailKey)
            ? emailToPersonId.get(emailKey)!
            : null

        // Otherwise look it up in the Person module.
        if (!existingPersonId && isUsableEmail(email)) {
          const persons = await personService.listPeople({ email })
          if (persons?.length > 0) existingPersonId = persons[0].id
        }

        const decision = decideOrderPersonBackfill({
          conversion: conv,
          email,
          existingPersonId,
        })

        if (decision.action === "skip") continue

        let personId: string
        let personCreated = false

        if (decision.action === "link") {
          personId = decision.person_id
        } else {
          // create
          if (dry_run) {
            personId = "(new)"
          } else {
            const name = derivePersonName({
              email,
              billing_address: order?.billing_address,
              shipping_address: order?.shipping_address,
              customer: order?.customer,
            })
            const person = await personService.createPeople({
              first_name: name.first_name,
              last_name: name.last_name,
              email,
              metadata: { source: "backfill-order-persons" },
            })
            personId = person.id
          }
          personCreated = true
          created++
        }

        if (decision.action === "link") linked++
        if (emailKey && personId !== "(new)") emailToPersonId.set(emailKey, personId)

        changes.push({
          entity: "conversion",
          id: conv.id,
          field: "person_id",
          before: null,
          after: { person_id: personId, person_created: personCreated, email },
        })

        if (!dry_run) {
          await adPlanning.updateConversions({ id: conv.id, person_id: personId })
        }
      } catch (e: any) {
        errors.push({ id: conv.id, message: e?.message ?? String(e) })
      }
    }

    return {
      job_id: backfillOrderPersonsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: summarizeOrderPersonBackfill(
        dry_run,
        candidates.length,
        linked,
        created,
        errors.length
      ),
      changes,
      errors,
    }
  },
}

/**
 * Hard cap on the marketing-outreach engagement sync scan. Each scanned row may
 * drive a provider lookup + one column write, so we bound the per-request blast
 * radius. Bigger sweeps raise `limit` across chunked calls.
 */
export const MAX_OUTREACH_SYNC_SCAN = 2000

const syncOutreachParamsSchema = z.object({
  /** Restrict the sync to one campaign. */
  campaign: z.string().min(1).optional(),
  /** Max candidate outreach rows to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_OUTREACH_SYNC_SCAN)
    .optional()
    .default(500),
})

/**
 * Optional provider adapter the deployment can register on the container under
 * `OUTREACH_SYNC_PROVIDER_KEY` to pull engagement events (e.g. a Resend
 * message-events client). When absent the job is a safe no-op — it never invents
 * engagement. The `POST /admin/marketing/outreach/sync` route is the push path
 * (webhook relays the events directly) and needs no provider.
 */
export const OUTREACH_SYNC_PROVIDER_KEY = "marketingOutreachSyncProvider"

export type OutreachSyncProvider = {
  fetchEvents: (
    rows: OutreachSyncRow[]
  ) => Promise<OutreachSyncEvent[]> | OutreachSyncEvent[]
}

function resolveOutreachSyncProvider(
  container: any
): OutreachSyncProvider | null {
  try {
    const provider = container.resolve(OUTREACH_SYNC_PROVIDER_KEY)
    return provider && typeof provider.fetchEvents === "function"
      ? (provider as OutreachSyncProvider)
      : null
  } catch {
    return null
  }
}

/**
 * #659 slice 4 / PR-4d — pull engagement events for non-terminal outreach rows
 * from the (optional) provider adapter and reconcile them forward-only. Inherits
 * the Data Plumbing console + ops_audit history for free via the registry.
 */
export const syncMarketingOutreachEngagementJob: MaintenanceJob = {
  id: "sync-marketing-outreach-engagement",
  label: "Sync marketing outreach engagement",
  description:
    `Reconcile marketing-outreach rows against an email-provider engagement feed (#659). Scans non-terminal rows that carry a provider message id (external_id), pulls their latest sent/opened/replied/bounced signals from the registered provider adapter, and advances each row forward-only (fills engagement timestamps, advances status, flags bounces as unreliable — never auto-suppresses). Dry-run (default) previews the change set without writing; apply persists. Idempotent. Requires a provider adapter registered as '${OUTREACH_SYNC_PROVIDER_KEY}'; without one the job is a safe no-op (the push route POST /admin/marketing/outreach/sync reconciles events posted directly). Optionally scope to one campaign. Scans up to 'limit' rows per call (default 500, max ${MAX_OUTREACH_SYNC_SCAN}).`,
  params: [
    {
      name: "campaign",
      type: "string",
      required: false,
      description: "Restrict the sync to one campaign (default: all)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max candidate rows to scan in one call (default 500, max ${MAX_OUTREACH_SYNC_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }) => {
    const parsed = syncOutreachParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { campaign, limit } = parsed.data

    const service: any = container.resolve(MARKETING_MODULE)
    const filters: Record<string, unknown> = {}
    if (campaign) filters.campaign = campaign

    const allRows = (await service.listMarketingOutreaches(filters, {
      order: { created_at: "DESC" },
      take: limit,
    })) as OutreachSyncRow[]
    const candidates = selectSyncableOutreach(allRows ?? [])

    const provider = resolveOutreachSyncProvider(container)
    if (!provider) {
      return {
        job_id: syncMarketingOutreachEngagementJob.id,
        dry_run,
        applied: false,
        summary: summarizeOutreachSync({
          dry_run,
          eventsReceived: 0,
          matchedRows: 0,
          changedRows: 0,
          totalChanges: 0,
          providerConfigured: false,
        }),
        changes: [],
      }
    }

    const events = (await provider.fetchEvents(candidates)) ?? []
    const result = reconcileOutreachBatch(candidates, events)

    if (!dry_run && result.items.length > 0) {
      for (const item of result.items) {
        await service.updateMarketingOutreaches({ id: item.id, ...item.patch })
      }
    }

    return {
      job_id: syncMarketingOutreachEngagementJob.id,
      dry_run,
      applied: !dry_run && result.items.length > 0,
      summary: summarizeOutreachSync({
        dry_run,
        eventsReceived: events.length,
        matchedRows: result.matchedRowIds.length,
        changedRows: result.items.length,
        totalChanges: result.changes.length,
        providerConfigured: true,
      }),
      changes: result.changes,
    }
  },
}

// ---------------------------------------------------------------------------
// run-marketing-ideas-email (#659) — operate the daily AI tactical-ideas email
// from the Data-Plumbing console (manual, audited dry-run → apply) instead of a
// hidden cron. Reuses the SAME injectable, never-throws `runDailyIdeasEmail`
// orchestrator (chains generate-ideas-email → guard → send-ideas-email) — no
// logic duplicated here. dry_run = generate + guard + persist the draft to
// `marketing_ideas_log` for review WITHOUT emailing; apply = email it (the apply
// click is the explicit consent, so it sends regardless of the env send-gate).
// Pass `log_id` to send a specific already-generated, guard-passed draft without
// a second LLM call (the dry-run returns the log id to paste back into apply).
// ---------------------------------------------------------------------------

/** Pure: parse a CSV/array `recipients` param into a clean string[] (or undefined). */
export function parseRecipientsCsv(raw: unknown): string[] | undefined {
  let list: unknown[] | null = null
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === "string" && raw.trim()) {
    list = raw.split(",")
  }
  if (!list) return undefined
  const out = list
    .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
    .filter((v) => v.length > 0)
  return out.length > 0 ? out : undefined
}

/**
 * Pure: turn the orchestrator summary (generate path) into a MaintenanceJobResult.
 * Exported for unit testing — keeps the dry-run/apply reporting verifiable without
 * booting the DB or the LLM.
 */
export function buildIdeasEmailGenerateResult(
  jobId: string,
  dry_run: boolean,
  summary: DailyIdeasEmailSummary
): MaintenanceJobResult {
  const logId = summary.log_id ?? "(none)"
  const changes: MaintenanceChange[] = []
  if (summary.generated) {
    changes.push({
      entity: "marketing_ideas_log",
      id: logId,
      field: "generated",
      after: { guard_passed: summary.guard_passed, errored: summary.errored },
    })
  }
  if (summary.guard_passed && summary.log_id) {
    changes.push({
      entity: "marketing_ideas_log",
      id: logId,
      field: "sent",
      before: false,
      after: dry_run ? "(would send)" : summary.sent > 0,
    })
  }
  const applied = !dry_run && summary.sent > 0
  const guardLabel = summary.guard_passed ? "passed" : "FAILED"
  const summaryText = dry_run
    ? `Dry-run: generated ideas log ${logId} (guard ${guardLabel}); ${
        summary.guard_passed ? "would send" : "send blocked"
      } — nothing emailed.`
    : `Generated ideas log ${logId} (guard ${guardLabel}); sent to ${summary.sent} recipient(s)${
        summary.skipped_reason ? ` (${summary.skipped_reason})` : ""
      }.`
  return { job_id: jobId, dry_run, applied, summary: summaryText, changes }
}

/**
 * Pure: report the send-an-existing-log path (when `log_id` is supplied). A log
 * is sendable only when it passed the guard and hasn't been sent yet.
 */
export function buildIdeasEmailSendExistingResult(
  jobId: string,
  dry_run: boolean,
  logId: string,
  log: { guard_passed?: boolean; sent?: boolean },
  sentCount: number
): MaintenanceJobResult {
  const sendable = log?.guard_passed === true && log?.sent !== true
  const changes: MaintenanceChange[] = []
  if (sendable) {
    changes.push({
      entity: "marketing_ideas_log",
      id: logId,
      field: "sent",
      before: false,
      after: dry_run ? "(would send)" : sentCount > 0,
    })
  }
  const applied = !dry_run && sentCount > 0
  const summaryText = !sendable
    ? `Ideas log ${logId} is not sendable (guard_passed=${
        log?.guard_passed === true
      }, sent=${log?.sent === true}) — nothing emailed.`
    : dry_run
    ? `Dry-run: ideas log ${logId} is guard-passed + unsent — would send. Nothing emailed.`
    : `Sent ideas log ${logId} to ${sentCount} recipient(s).`
  return { job_id: jobId, dry_run, applied, summary: summaryText, changes }
}

export const runMarketingIdeasEmailJob: MaintenanceJob = {
  id: "run-marketing-ideas-email",
  label: "Run marketing tactical-ideas email",
  description:
    "Run the daily AI VP-of-Marketing tactical-ideas email on demand (#659). Dry-run (default) generates the email, runs the hallucination guard, and persists the draft to marketing_ideas_log for review — but emails NO ONE. Apply emails it (the apply click is the explicit send consent, so it overrides the MARKETING_IDEAS_EMAIL_ENABLED env gate). Optionally pass log_id to send a specific already-generated, guard-passed draft without a second LLM call, and/or recipients (comma-separated) to override the default operator recipients.",
  params: [
    {
      name: "log_id",
      type: "string",
      required: false,
      description:
        "Send a specific existing marketing_ideas_log draft (skips regeneration). Omit to generate a fresh email.",
    },
    {
      name: "recipients",
      type: "string",
      required: false,
      description:
        "Comma-separated recipient override (default: MARKETING_IDEAS_RECIPIENTS env / platform admins).",
    },
  ],
  run: async (container, { dry_run, params }) => {
    const recipients = parseRecipientsCsv(params.recipients)
    const logId =
      typeof params.log_id === "string" && params.log_id.trim()
        ? params.log_id.trim()
        : undefined

    // --- send-an-existing-draft path -------------------------------------
    if (logId) {
      const marketing: any = container.resolve(MARKETING_MODULE)
      let log: any
      try {
        log = await marketing.retrieveMarketingIdeasLog(logId)
      } catch {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `marketing_ideas_log ${logId} not found`
        )
      }
      const sendable = log?.guard_passed === true && log?.sent !== true
      let sentCount = 0
      if (!dry_run && sendable) {
        const { result } = await sendIdeasEmailWorkflow(container).run({
          input: { logId, ...(recipients ? { recipients } : {}) },
        })
        sentCount = result?.sent ?? 0
      }
      return buildIdeasEmailSendExistingResult(
        runMarketingIdeasEmailJob.id,
        dry_run,
        logId,
        log,
        sentCount
      )
    }

    // --- generate (+ send on apply) path; apply is the explicit consent ----
    const summary = await runDailyIdeasEmail(container, {
      sendEnabled: !dry_run,
      ...(recipients ? { recipients } : {}),
    })
    return buildIdeasEmailGenerateResult(
      runMarketingIdeasEmailJob.id,
      dry_run,
      summary
    )
  },
}

// ---------------------------------------------------------------------------
// install-marketing-ideas-email-flow (#659) — LOAD the daily ideas-email visual
// flow into the system from the Data Plumbing console, instead of shelling in to
// run `medusa exec ./src/scripts/seed-marketing-daily-ideas-email-flow.ts`. The
// flow (schedule 30 1 * * * ≈ 07:00 IST → marketing_daily_ideas_email op → log)
// runs hands-off daily and is retimable from the canvas. Same FLOW_DEF as the
// CLI seed (single source of truth). Idempotent — refuses to overwrite an
// existing flow; created as a DRAFT (send stays OFF until the operator opts in).
// ---------------------------------------------------------------------------

/**
 * Pure: report the install-flow dry-run/apply outcome. Exported for unit testing
 * so the preview/created/already-exists wording is verifiable without the DB.
 */
export function summarizeFlowInstall(args: {
  jobId: string
  dry_run: boolean
  flowName: string
  cron: string
  nodeCount: number
  existingId: string | null
  createdId: string | null
}): MaintenanceJobResult {
  const { jobId, dry_run, flowName, cron, nodeCount, existingId, createdId } =
    args
  if (existingId) {
    return {
      job_id: jobId,
      dry_run,
      applied: false,
      summary: `Visual flow "${flowName}" already installed (${existingId}) — nothing to do. Retime the schedule (${cron}) from the canvas.`,
      changes: [],
    }
  }
  const changes: MaintenanceChange[] = [
    {
      entity: "visual_flow",
      id: createdId ?? "(new)",
      field: "created",
      after: { name: flowName, trigger: `schedule ${cron}`, nodes: nodeCount },
    },
  ]
  const applied = !dry_run && !!createdId
  const summary = dry_run
    ? `Would create visual flow "${flowName}" (schedule ${cron}, ${nodeCount} nodes) — nothing written. Apply to install.`
    : `Created visual flow "${flowName}" (${createdId}); schedule ${cron}. Flip draft→active + opt into send (MARKETING_IDEAS_EMAIL_ENABLED or the node's send_enabled) to go live.`
  return { job_id: jobId, dry_run, applied, summary, changes }
}

export const installMarketingIdeasEmailFlowJob: MaintenanceJob = {
  id: "install-marketing-ideas-email-flow",
  label: "Install marketing ideas-email visual flow",
  description:
    "Load/create the 'Marketing Daily Ideas Email' visual flow into the system from the console — no shell or seed script needed (#659). The flow schedules the daily AI tactical-ideas email (generate + hallucination guard + gated send) and is retimable from the canvas. Dry-run previews the flow it would create (or reports it already exists); apply creates it idempotently as a DRAFT. Send stays OFF until you set MARKETING_IDEAS_EMAIL_ENABLED or the node's send_enabled and flip the flow draft→active. Re-running never overwrites an existing flow.",
  params: [],
  run: async (container, { dry_run }) => {
    const service: any = container.resolve(VISUAL_FLOWS_MODULE)
    const flowName = IDEAS_EMAIL_FLOW_DEF.name
    const cron = IDEAS_EMAIL_FLOW_DEF.trigger_config?.cron ?? ""
    const nodeCount = IDEAS_EMAIL_FLOW_DEF.canvas_state?.nodes?.length ?? 0

    const [existing] = await service.listVisualFlows({ name: flowName })
    if (existing) {
      return summarizeFlowInstall({
        jobId: installMarketingIdeasEmailFlowJob.id,
        dry_run,
        flowName,
        cron,
        nodeCount,
        existingId: existing.id,
        createdId: null,
      })
    }

    let createdId: string | null = null
    if (!dry_run) {
      const flow = await service.createCompleteFlow({
        flow: {
          name: IDEAS_EMAIL_FLOW_DEF.name,
          description: IDEAS_EMAIL_FLOW_DEF.description,
          status: IDEAS_EMAIL_FLOW_DEF.status,
          trigger_type: IDEAS_EMAIL_FLOW_DEF.trigger_type,
          trigger_config: IDEAS_EMAIL_FLOW_DEF.trigger_config,
          canvas_state: IDEAS_EMAIL_FLOW_DEF.canvas_state,
        },
        operations: IDEAS_EMAIL_FLOW_DEF.operations,
        connections: IDEAS_EMAIL_FLOW_DEF.connections,
      })
      createdId = flow?.id ?? null
    }

    return summarizeFlowInstall({
      jobId: installMarketingIdeasEmailFlowJob.id,
      dry_run,
      flowName,
      cron,
      nodeCount,
      existingId: null,
      createdId,
    })
  },
}

export const MAINTENANCE_JOBS: MaintenanceJob[] = [
  recalculateDesignCostJob,
  recalculateDesignCostBulkJob,
  correctProductionRunCostJob,
  backfillInventoryUnitCostJob,
  backfillDesignEnergyCostJob,
  pruneOpsAuditRunsJob,
  backfillPartnerOrderCurrencyJob,
  repairPartnerRegionLinksJob,
  resyncProductLandingUrlJob,
  backfillConsumptionLogProductionRunIdJob,
  repairInventoryRawMaterialLinksJob,
  backfillPartnerOrderFeesJob,
  backfillStatsPanelWindowJob,
  backfillOrderPersonsJob,
  syncMarketingOutreachEngagementJob,
  runMarketingIdeasEmailJob,
  installMarketingIdeasEmailFlowJob,
]

export const getMaintenanceJob = (id: string): MaintenanceJob | undefined =>
  MAINTENANCE_JOBS.find((job) => job.id === id)
