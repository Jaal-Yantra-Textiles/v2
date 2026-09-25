import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { resolvePartnerLocation } from "../../../../workflows/production-runs/lib/partner-location"
import {
  checkOutputLines,
  parseOutputParam,
  resolveProducedOutput,
  runGoodQuantity,
  runOutputAxes,
  type OutputLine,
} from "../../../../workflows/production-runs/lib/run-output"
import {
  bankStockLines,
  resolveRunStockTarget,
} from "../../../../workflows/production-runs/lib/run-output-variants"
import { resolveRunVariant } from "../../../../workflows/production-runs/lib/run-variant"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Bank the goods of ONE completed run that never reached stock (#2271).
 *
 * The live case: Alpha 60 Top ×1 and Luong Shirt ×3 were completed on
 * 2026-09-24 when their designs had no product, so stocking had nothing to bank
 * onto. Approval minted the products a day later and banked nothing — goods
 * that physically exist at Sharlho appear in no inventory at all.
 *
 * 🔴 One run per call, named by id. Never a sweep: many older runs' goods were
 * already shipped or sold, and banking them now would mint phantom stock — the
 * ₹11,000 jacket. Refused outright for runs tied to a customer order (their
 * goods went to the customer) and for runs already stamped `stocked_at`.
 *
 * The split per size/colour comes from `produced_output` ("S:1,M:2"), else what
 * the run recorded, else its plan / only combination. Several sizes and no
 * answer is refused — the same rule as completion.
 *
 * Preview (dry_run, the default) writes nothing and does not mint.
 */

export { parseOutputParam }

export const bankUnstockedRunJob: MaintenanceJob = {
  id: "bank-unstocked-run",
  label: "Bank a completed run's goods that never reached stock",
  description:
    "For ONE completed production run whose goods were never banked (stocked_at is empty) — e.g. it completed before its design had a product. Records the good units at the producing partner's warehouse, one variant per size/colour made, minting a DRAFT product when the design has none. Pass produced_output as 'S:1,M:2' when the run is for several sizes (optional '/colour': 'S/Indigo:1'). Refuses parent runs, runs tied to a customer order (their goods went to the customer), and runs already banked. Preview (dry run) writes nothing and mints nothing.",
  params: [
    { name: "run_id", type: "string", required: true, description: "The completed production run (prod_run_...)" },
    {
      name: "produced_output",
      type: "string",
      required: false,
      description: "What was made per size/colour, e.g. 'S:1,M:2'. Must add up to the run's good units.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const runId = String(params.run_id ?? "").trim()
    if (!runId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "run_id is required")
    }
    const service: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const run = await service.retrieveProductionRun(runId).catch(() => null)
    if (!run) throw new MedusaError(MedusaError.Types.NOT_FOUND, `run ${runId} not found`)

    const refuse = (why: string) => {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `run ${runId}: ${why}`)
    }
    if (run.status !== "completed") refuse(`is ${run.status}, not completed`)
    if (run.stocked_at) refuse(`already banked (${run.stocked_quantity} at ${run.stocked_at_location_id})`)
    if (run.order_id || run.order_line_item_id) {
      refuse("is tied to a customer order — its goods went to the customer, banking them would mint phantom stock")
    }
    const { data: children } = await query.graph({
      entity: "production_runs",
      filters: { parent_run_id: runId },
      fields: ["id"],
    })
    if (children?.length) refuse("is a parent run — its children bank their own goods")

    const good = runGoodQuantity(run)
    if (!(good > 0)) refuse("has no good units to bank")

    // What was made, per size/colour.
    let lines: OutputLine[]
    if (params.produced_output != null && String(params.produced_output).trim()) {
      const check = checkOutputLines(
        parseOutputParam(String(params.produced_output)),
        runOutputAxes(run.snapshot),
        good
      )
      if (!check.ok) refuse(`produced_output: ${check.reason}`)
      lines = (check as any).lines
    } else {
      const resolved = resolveProducedOutput({
        confirmed: run.produced_output ?? undefined,
        planned_output: run.planned_output,
        snapshot: run.snapshot,
        good_quantity: good,
      })
      if (!resolved.ok) refuse(`${resolved.reason} — pass produced_output, e.g. S:1,M:2`)
      lines = (resolved as any).lines
    }

    const location = await resolvePartnerLocation(container, run.partner_id)
    if (!location.location_id) refuse(`partner ${run.partner_id} has no stock location (${location.reason})`)
    const locationId = location.location_id as string

    const changes: MaintenanceChange[] = lines.map((l) => ({
      entity: "inventory_level",
      id: `${[l.size_label, l.color].filter(Boolean).join("/") || "unsized"}@${locationId}`,
      field: "stocked_quantity",
      before: null,
      after: `+${l.quantity}`,
      reason: `run ${runId} (${run.snapshot?.design?.name ?? run.design_id}) — ${good} good unit(s)`,
    } as MaintenanceChange))

    if (dry_run) {
      return {
        job_id: "bank-unstocked-run",
        dry_run: true,
        applied: false,
        summary:
          `Would bank ${good} unit(s) of run ${runId} at ${locationId}: ` +
          lines.map((l) => `${[l.size_label, l.color].filter(Boolean).join("/") || "unsized"} ×${l.quantity}`).join(", ") +
          `. Variants (and a draft product, if the design has none) are created on apply.`,
        changes,
      }
    }

    // Record the split on the run first, so the target resolver and every
    // later reader see the same answer.
    const runForTarget = { ...run, produced_output: lines }
    await service.updateProductionRuns({ id: runId, produced_output: lines as any })

    const target = await resolveRunStockTarget(container, { run: runForTarget, good_quantity: good })
    let stockLines: Array<{ inventory_item_id: string; quantity: number }>
    const stamp: Record<string, unknown> = {}

    if (target.mode === "skip") refuse(`cannot bank: ${(target as any).reason}`)
    if (target.mode === "lines") {
      stockLines = target.lines
      stamp.product_id = target.product_id
      if (target.lines.length === 1) stamp.variant_id = target.lines[0].variant_id
    } else {
      const variant = await resolveRunVariant(container, run)
      if (!variant.inventory_item_id) refuse(`no variant to bank onto (${variant.reason})`)
      stockLines = [{ inventory_item_id: variant.inventory_item_id as string, quantity: good }]
    }

    const banked = await bankStockLines(container, { location_id: locationId, lines: stockLines! })
    const total = banked.reduce((acc, b) => acc + b.quantity, 0)
    await service.updateProductionRuns({
      id: runId,
      ...stamp,
      stocked_at_location_id: locationId,
      stocked_quantity: total,
      stocked_at: new Date(),
    })

    return {
      job_id: "bank-unstocked-run",
      dry_run: false,
      applied: total > 0,
      summary: `Banked ${total} unit(s) of run ${runId} at ${locationId}${
        target.mode === "lines" && target.minted_product ? " (minted a draft product)" : ""
      }.`,
      changes,
    }
  },
}
