import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import { checkCompletionOutput } from "../../../../../workflows/production-runs/complete-production-run"
import { resolvePartnerLocation } from "../../../../../workflows/production-runs/lib/partner-location"
import {
  parseOutputParam,
  resolveProducedOutput,
  runGoodQuantity,
  runOutputAxes,
} from "../../../../../workflows/production-runs/lib/run-output"
import {
  decideRunStockTarget,
  MADE_TO_ORDER,
} from "../../../../../workflows/production-runs/lib/run-output-variants"
import { resolveRunVariant } from "../../../../../workflows/production-runs/lib/run-variant"

/**
 * GET /admin/production-runs/:id/completion-preview
 *
 * What completing this run WOULD do — run against prod data, writing nothing
 * (#2271). A GET, so it is a read by construction: no mint, no variant, no
 * stock, no status change.
 *
 * Query overrides (all optional) let an operator ask "what if":
 *   produced_quantity, rejected_quantity — the counts to complete with
 *   produced_output — the split, as "S:1,M:2" (or "S/Indigo:1")
 *   allow_shortfall, notes — as the completion gate reads them
 *
 * Without overrides it replays the run as recorded, which is what makes it
 * useful on an ALREADY completed run: "what would banking these goods do now?".
 *
 * It calls the same decision completion calls (`decideRunStockTarget`), so the
 * preview cannot drift from the real path.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const runId = req.params.id
  const q = (req.query ?? {}) as Record<string, string | undefined>
  const service: any = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const run = await service.retrieveProductionRun(runId).catch(() => null)
  if (!run) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Production run ${runId} not found`)

  const num = (v?: string) => (v == null || v === "" ? undefined : Number(v))
  const produced = num(q.produced_quantity) ?? run.produced_quantity ?? undefined
  const rejected = num(q.rejected_quantity) ?? run.rejected_quantity ?? undefined
  const confirmed = q.produced_output ? parseOutputParam(q.produced_output) : undefined

  const notes: string[] = []
  const isCompleted = run.status === "completed"
  if (isCompleted) {
    notes.push(
      run.stocked_at
        ? `already completed and banked (${run.stocked_quantity} at ${run.stocked_at_location_id}) — completion would not run again`
        : "already completed and NOT banked — this is what the bank-unstocked-run job would do"
    )
  }
  if (run.order_id || run.order_line_item_id) {
    notes.push("tied to a customer order — stock is reserved for that order line (legacy path)")
  }

  const { data: children } = await query.graph({
    entity: "production_runs",
    filters: { parent_run_id: runId },
    fields: ["id"],
  })
  const isParent = (children ?? []).length > 0
  if (isParent) notes.push(`parent of ${children.length} run(s) — its children bank their own goods`)

  // 1. The completion gate (the same check the workflow runs).
  const gate = isCompleted
    ? { ok: true as const, skipped: "run already completed" }
    : checkCompletionOutput({
        assigned: run.quantity,
        produced,
        rejected,
        allowShortfall: q.allow_shortfall === "true",
        notes: q.notes,
      })

  // 2. What was made, per size/colour.
  const good = runGoodQuantity({
    produced_quantity: produced,
    rejected_quantity: rejected,
    quantity: run.quantity,
  })
  const axes = runOutputAxes(run.snapshot)
  const output = resolveProducedOutput({
    confirmed: confirmed ?? (isCompleted ? run.produced_output ?? undefined : undefined),
    planned_output: run.planned_output,
    snapshot: run.snapshot,
    good_quantity: good,
  })

  if (!output.ok && output.code === "split_required" && !isCompleted) {
    notes.push(
      "the partner and admin complete routes would REFUSE this completion until the split is given " +
        "(WhatsApp would complete it and bank nothing)"
    )
  }
  if (!output.ok && output.code === "invalid_confirmed") {
    notes.push(`completion would REFUSE this split: ${output.reason}`)
  }

  // 3. Where the goods go.
  const location = await resolvePartnerLocation(req.scope, run.partner_id)
  const decision = isParent
    ? ({ mode: "legacy" } as const)
    : await decideRunStockTarget(req.scope, {
        run: { ...run, produced_output: output.ok ? output.lines : null },
        good_quantity: good,
        has_location: !!location.location_id,
      })

  const wouldWrite: string[] = []
  let legacyVariant: any = null
  const at = location.location_id ?? "(no warehouse)"

  if (!isParent && good > 0) {
    if (decision.mode === "skip") {
      wouldWrite.push(`nothing banked — ${decision.reason}`)
    } else if (decision.mode === "legacy") {
      legacyVariant = await resolveRunVariant(req.scope, run)
      wouldWrite.push(
        legacyVariant.inventory_item_id
          ? `stock +${good} on variant ${legacyVariant.variant_id} at ${at}`
          : `nothing banked — ${legacyVariant.reason ?? "no variant"}`
      )
    } else {
      if (!decision.product_id && decision.draft_price) {
        const p = decision.draft_price
        wouldWrite.push(
          `mint DRAFT product for design ${run.design_id} at ${p.price} ${p.currency.toUpperCase()} (${p.source})`
        )
      }
      const plan = decision.plan
      for (const o of plan?.add_options ?? []) wouldWrite.push(`add option ${o.title}: ${o.values.join(", ")}`)
      for (const o of plan?.add_values ?? []) wouldWrite.push(`add values to ${o.title}: ${o.values.join(", ")}`)
      for (const b of plan?.backfill ?? []) {
        wouldWrite.push(`set variant ${b.variant_id} to ${JSON.stringify(b.options)}`)
      }
      for (const line of decision.lines) {
        const label =
          [line.size_label, line.color].filter(Boolean).join(" / ") ||
          (plan ? MADE_TO_ORDER : "unsized")
        const existing = plan?.lines.find(
          (l) => l.size_label === line.size_label && l.color === line.color
        )?.variant_id
        wouldWrite.push(
          existing
            ? `stock +${line.quantity} on existing variant ${existing} (${label}) at ${at}`
            : `create variant ${label}, then stock +${line.quantity} at ${at}`
        )
      }
    }
  }

  res.json({
    preview: true,
    writes: "none — this endpoint only reads",
    run: {
      id: run.id,
      status: run.status,
      design_id: run.design_id,
      partner_id: run.partner_id,
      quantity: run.quantity,
      sizes: axes.sizes,
      colors: axes.colors,
      planned_output: run.planned_output ?? null,
    },
    completion_gate: gate,
    counts: { produced: produced ?? null, rejected: rejected ?? null, good_units: good },
    produced_output: output,
    warehouse: location.location_id
      ? { location_id: location.location_id, source: location.source }
      : { location_id: null, reason: location.reason },
    stock_path: decision.mode,
    ...(decision.mode === "skip" ? { skip_reason: decision.reason } : {}),
    ...(legacyVariant ? { legacy_variant: legacyVariant } : {}),
    would_write: wouldWrite,
    notes,
  })
}
