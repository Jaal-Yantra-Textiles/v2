import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import {
  reconcileDesigns,
  type ReconcileLog,
  type ReconcileRun,
} from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — REPORT-ONLY: what each design produced vs what it reported
 * consuming.
 *
 * Committed consumption is the only evidence that material left the shelf, and
 * that evidence is thin: of nine designs with real production, five logged no
 * material at all and one reported 1.75 m against nine finished pieces.
 * Settling those figures against stock would move a rounding error while the
 * real outflow stayed invisible, so this job measures the gap instead.
 *
 * It NEVER writes. `dry_run: false` produces the same report — there is nothing
 * to apply, because an expected quantity is a model and the stock ledger must
 * keep meaning "what is on the shelf". Where a variance is real, the fix is to
 * correct the LOG (mirroring how an admin corrects a partner's reported output),
 * after which `apply-committed-consumption-to-inventory` deducts the corrected
 * figure.
 */

const paramsSchema = z.object({
  design_id: z.string().min(1).optional(),
  /**
   * Expected metres per finished piece, keyed by design id. Accepts a JSON
   * string too — the ops UI and the MCP tool both pass params as scalars.
   */
  rate_per_unit: z
    .preprocess((v) => {
      if (typeof v !== "string") {
        return v
      }
      try {
        return JSON.parse(v)
      } catch {
        return v // fall through to the record check, which reports a clear error
      }
    }, z.record(z.string(), z.number().positive()))
    .optional(),
  /** Flag any design whose implied metres/piece falls below this. */
  implausible_rate_below: z.number().positive().optional(),
  /** Only return designs carrying at least one flag. Default true. */
  flagged_only: z.boolean().optional(),
  /** Basis to assume for legacy logs whose quantity_basis is null. */
  assume_basis: z.enum(["total", "per_piece"]).optional(),
})

export const reconcileConsumptionVsProductionJob: MaintenanceJob = {
  id: "reconcile-consumption-vs-production",
  label: "Reconcile consumption against production (report-only)",
  description:
    "Compare what each design PRODUCED against what it reported CONSUMING. Counts completed leaf runs only (#498) and excludes provenance runs minted from retail fulfillment — those shipped from stock and consumed nothing, so counting them invents material. Reads each log's quantity_basis and resolves a per_piece rate against the run's piece count before summing, as the apply job does; a log whose basis is unknown is reported as unknown_basis rather than guessed, and the verdicts that depend on a complete total are withheld for that design. Flags: production with zero material logged, consumption with no production, implausible metres/piece, logs not attributed to a production run, and unreadable logs. Reports an expected/variance figure when a per-unit rate is supplied. NEVER writes — correct the log, then run the apply job.",
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Only this design (omit to scan every design)",
    },
    {
      name: "rate_per_unit",
      type: "string",
      required: false,
      description:
        'Expected material per finished piece, keyed by design id, e.g. {"01KWWJ0S3Z…": 2.5}',
    },
    {
      name: "implausible_rate_below",
      type: "number",
      required: false,
      description: "Flag designs whose implied metres/piece is under this (default 0.5)",
    },
    {
      name: "flagged_only",
      type: "boolean",
      required: false,
      description: "Return only designs with at least one flag (default true)",
    },
    {
      name: "assume_basis",
      type: "string",
      required: false,
      description:
        "total | per_piece — how to read logs written before the form recorded a basis. Omit and those logs are reported as unknown_basis rather than guessed.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const {
      design_id,
      rate_per_unit,
      implausible_rate_below,
      flagged_only,
      assume_basis,
    } = parsed.data

    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const consumptionService: any = container.resolve(CONSUMPTION_LOG_MODULE)

    const runFilters: Record<string, any> = {}
    const logFilters: Record<string, any> = { is_committed: true }
    if (design_id) {
      runFilters.design_id = design_id
      logFilters.design_id = design_id
    }

    const [rawRuns] = await runService.listAndCountProductionRuns(runFilters, {
      take: null,
    })
    const [rawLogs] = await consumptionService.listAndCountConsumptionLogs(
      logFilters,
      { take: null }
    )

    const runs: ReconcileRun[] = ((rawRuns || []) as any[]).map((r) => ({
      id: r.id,
      design_id: r.design_id ?? null,
      parent_run_id: r.parent_run_id ?? null,
      status: r.status ?? null,
      produced_quantity: r.produced_quantity ?? null,
      quantity: r.quantity ?? null,
      metadata: r.metadata ?? null,
    }))
    const logs: ReconcileLog[] = ((rawLogs || []) as any[]).map((l) => ({
      id: l.id,
      design_id: l.design_id ?? null,
      inventory_item_id: l.inventory_item_id ?? null,
      production_run_id: l.production_run_id ?? null,
      quantity: l.quantity ?? null,
      // Projected explicitly: a field the query never fetched reads as
      // `undefined`, which resolves to "basis unknown" and would report every
      // design as unreadable.
      quantity_basis: l.quantity_basis ?? null,
      is_committed: Boolean(l.is_committed),
    }))

    const all = reconcileDesigns({
      runs,
      logs,
      ratePerUnit: rate_per_unit,
      implausibleRateBelow: implausible_rate_below,
      assumeBasisWhenUnknown: assume_basis,
    })
    const rows = flagged_only === false ? all : all.filter((r) => r.flags.length)

    // Reported as `changes` purely so the ops UI renders the table; before/after
    // are the observation, not a proposed write.
    const changes: MaintenanceChange[] = rows.map((r) => ({
      entity: "design",
      id: r.design_id,
      field: `produced ${r.produced} / shipped-from-stock ${r.shipped_from_stock}${
        r.unresolved_logs
          ? ` / ${r.unresolved_logs} log(s) unreadable (raw ${r.unresolved_quantity})`
          : ""
      } [${r.flags.join(", ")}]`,
      before: r.expected ?? r.produced,
      after: r.consumed,
    }))

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      for (const f of r.flags) {
        acc[f] = (acc[f] ?? 0) + 1
      }
      return acc
    }, {})

    const summary = [
      `Reconciled ${all.length} design(s); ${rows.length} flagged`,
      Object.keys(counts).length
        ? Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([f, n]) => `${n}× ${f}`)
            .join("; ")
        : "no flags",
      "report-only — no stock was moved",
    ].join(". ")

    return {
      job_id: reconcileConsumptionVsProductionJob.id,
      dry_run,
      // Nothing is ever written, so this is false even for dry_run: false.
      applied: false,
      summary,
      changes,
    }
  },
}
