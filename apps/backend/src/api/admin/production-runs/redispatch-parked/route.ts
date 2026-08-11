/**
 * @file Re-send parked production runs back to the partner who let them lapse.
 * @module API/Admin/ProductionRuns
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import {
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type ProductionRunService from "../../../../modules/production_runs/service"
import { assignProductionRunPartnerWorkflow } from "../../../../workflows/production-runs/assign-production-run-partner"
import {
  dispatchProductionRunWorkflow,
  dispatchProductionRunWorkflowId,
  waitDispatchTemplateSelectionStepId,
} from "../../../../workflows/production-runs/dispatch-production-run"
import type { AdminRedispatchParkedRunsReq } from "../validators"
import { planRedispatch } from "./plan"

/**
 * "Send these back to the same partner."
 *
 * A run whose partner never accepted (reminder cap) or who declined is parked
 * in `awaiting_reassignment` with `partner_id` cleared and the old partner kept
 * on `previous_partner_id`. Getting one moving again is three separate calls —
 * assign, start dispatch, resume dispatch with template names — and the common
 * case is a batch of them for one partner who has since said yes. Doing that by
 * hand, per run, is where they get left parked.
 *
 * Re-assignment goes to `previous_partner_id`, per run. Not to a partner_id
 * passed in: this endpoint only ever sends work back where it came from, so a
 * typo cannot hand one partner's runs to another. `partner_id` FILTERS.
 *
 * `template_names` is what makes it end-to-end. Dispatch parks at
 * `awaiting_templates` until a selection arrives, and nothing records which
 * templates a run used last time — tasks do not carry their template. Omit it
 * and each run is assigned and started but left awaiting a selection, which is
 * reported rather than guessed at.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody || req.body) as AdminRedispatchParkedRunsReq
  const dryRun = body.dry_run !== false

  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const [parked] = await (service as any).listAndCountProductionRuns(
    {
      status: "awaiting_reassignment",
      ...(body.partner_id ? { previous_partner_id: body.partner_id } : {}),
    },
    { take: null }
  )

  const { selected, orphaned, deferred } = planRedispatch(
    (parked || []) as any[],
    { partnerId: body.partner_id, limit: body.limit ?? undefined }
  )

  if (dryRun) {
    return res.json({
      dry_run: true,
      would_redispatch: selected.map(({ run, partner_id }) => ({
        production_run_id: run.id,
        partner_id,
        design_id: run.design_id ?? null,
        quantity: run.quantity ?? null,
        parked_reason: run.cancelled_reason ?? null,
      })),
      skipped_without_previous_partner: orphaned.map((r) => r.id),
      deferred_by_limit: deferred.map((r) => r.id),
      will_await_template_selection: !body.template_names?.length,
      summary: `Would re-send ${selected.length} parked run(s) to the partner they came from${
        body.template_names?.length
          ? ` and dispatch with ${body.template_names.join(", ")}`
          : ", each left awaiting a template selection"
      }${orphaned.length ? `. ${orphaned.length} skipped with no previous partner` : ""}${
        deferred.length ? `. ${deferred.length} held back by limit` : ""
      }`,
    })
  }

  if (!body.confirm) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This re-assigns and dispatches real work to partners. Re-send with confirm:true once the dry-run looks right."
    )
  }

  const engine = req.scope.resolve(Modules.WORKFLOW_ENGINE) as IWorkflowEngineService
  const results: any[] = []

  for (const { run, partner_id: partnerId } of selected) {
    try {
      await assignProductionRunPartnerWorkflow(req.scope).run({
        input: {
          production_run_id: run.id,
          partner_id: partnerId,
          note: body.note ?? "Re-sent to the same partner",
          source: "manual",
        },
      })

      const { transaction } = await dispatchProductionRunWorkflow(req.scope).run({
        input: { production_run_id: run.id },
      })
      const transactionId = (transaction as any)?.transactionId

      let dispatched = false
      if (body.template_names?.length && transactionId) {
        await engine.setStepSuccess({
          idempotencyKey: {
            action: TransactionHandlerType.INVOKE,
            transactionId,
            stepId: waitDispatchTemplateSelectionStepId,
            workflowId: dispatchProductionRunWorkflowId,
          },
          stepResponse: new StepResponse({
            template_names: body.template_names,
          }),
        })
        dispatched = true
      }

      results.push({
        production_run_id: run.id,
        partner_id: partnerId,
        assigned: true,
        dispatched,
        transaction_id: transactionId ?? null,
        awaiting_templates: !dispatched,
      })
    } catch (e: any) {
      // One partner's run failing must not strand the rest of the batch —
      // each run is an independent assign + dispatch.
      results.push({
        production_run_id: run.id,
        partner_id: partnerId,
        assigned: false,
        dispatched: false,
        error: e?.message ?? String(e),
      })
    }
  }

  const ok = results.filter((r) => r.assigned)
  const dispatched = results.filter((r) => r.dispatched)
  const failed = results.filter((r) => !r.assigned)

  res.json({
    dry_run: false,
    results,
    summary: `Re-sent ${ok.length} of ${selected.length} parked run(s) to the partner they came from; ${dispatched.length} fully dispatched${
      ok.length - dispatched.length > 0
        ? `, ${ok.length - dispatched.length} awaiting a template selection`
        : ""
    }${failed.length ? `; ${failed.length} failed` : ""}`,
  })
}
