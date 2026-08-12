/**
 * @file Re-send parked production runs back to the partner who let them lapse.
 * @module API/Admin/ProductionRuns
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { IWorkflowEngineService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"

import productionRunsTasksLink from "../../../../links/production-runs-tasks"
import { TASKS_MODULE } from "../../../../modules/tasks"
import type TaskService from "../../../../modules/tasks/service"
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
import {
  recoverRunTemplates,
  resolveDispatchTemplates,
  type RunTemplateHistory,
} from "./template-history"

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
 * `awaiting_templates` until a selection arrives; omit a selection and each run
 * is assigned and started but left awaiting one, which is reported rather than
 * guessed at.
 *
 * The selection no longer has to be remembered. Every run's existing tasks carry
 * `metadata.template_name` / `template_id` (stamped by
 * `createTaskWithTemplates`), so the dry-run REPORTS what each run went out with
 * last time, and `use_previous_templates` dispatches each run with ITS OWN
 * recovered set. Per run, never pooled: on prod the seven parked runs used four
 * different sets, so one batch-wide list would have been wrong for most of them
 * — the same reasoning that makes `partner_id` filter rather than assign.
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

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const taskService: TaskService = req.scope.resolve(TASKS_MODULE)

  // Names are not unique — prod carries two templates called "Stitching" — and
  // dispatch resolves by name, so a recovered name can land on the wrong row.
  // Counting them here lets the response SAY which ones are ambiguous instead
  // of quietly picking.
  const templateNameCounts = new Map<string, number>()
  try {
    const allTemplates = await (taskService as any).listTaskTemplates(
      {},
      { take: null }
    )
    for (const t of allTemplates || []) {
      const n = (t as any)?.name
      if (typeof n === "string" && n.length) {
        templateNameCounts.set(n, (templateNameCounts.get(n) ?? 0) + 1)
      }
    }
  } catch {
    // Ambiguity reporting is a courtesy, not a precondition. Losing it must not
    // block a re-dispatch.
  }

  /**
   * What each run went out with last time, read from the tasks it already has.
   * Per run — pooling them would reintroduce exactly the mis-routing that
   * `previous_partner_id` exists to prevent.
   */
  const historyByRun = new Map<string, RunTemplateHistory>()
  for (const { run } of selected) {
    try {
      const { data: links } = await query.graph({
        entity: productionRunsTasksLink.entryPoint,
        fields: ["task_id"],
        filters: { production_runs_id: run.id },
      })
      const taskIds = (links || [])
        .map((l: any) => l?.task_id)
        .filter(Boolean)

      const tasks = taskIds.length
        ? await taskService.listTasks({ id: taskIds } as any, { take: null })
        : []

      historyByRun.set(
        run.id,
        recoverRunTemplates(tasks as any[], run as any, { templateNameCounts })
      )
    } catch {
      // A run whose history cannot be read is reported as having none, which
      // reads the same as never having been dispatched. Never fatal.
      historyByRun.set(run.id, {
        templates: [],
        source: "none",
        ambiguous_names: [],
      })
    }
  }

  const usePrevious = body.use_previous_templates === true

  if (dryRun) {
    const rows = selected.map(({ run, partner_id }) => {
      const history = historyByRun.get(run.id)!
      const resolved = resolveDispatchTemplates(history, {
        explicit: body.template_names,
        usePrevious,
      })
      return {
        production_run_id: run.id,
        partner_id,
        design_id: run.design_id ?? null,
        quantity: run.quantity ?? null,
        parked_reason: run.cancelled_reason ?? null,
        /** What this run went out with last time — the selection to confirm. */
        previous_template_names: history.templates.map((t) => t.name),
        previous_template_ids: history.templates.map((t) => t.template_id),
        previous_templates_source: history.source,
        ambiguous_template_names: history.ambiguous_names,
        /** What this run would ACTUALLY dispatch with, given the request. */
        would_dispatch_with: resolved.template_names,
        would_await_template_selection: !resolved.template_names.length,
      }
    })

    const recovered = rows.filter((r) => r.previous_template_names.length)
    const stillAwaiting = rows.filter((r) => r.would_await_template_selection)
    const ambiguous = rows.filter((r) => r.ambiguous_template_names.length)
    const distinctSets = new Set(
      recovered.map((r) => r.previous_template_names.join(" + "))
    )

    return res.json({
      dry_run: true,
      would_redispatch: rows,
      skipped_without_previous_partner: orphaned.map((r) => r.id),
      deferred_by_limit: deferred.map((r) => r.id),
      will_await_template_selection: stillAwaiting.length > 0,
      /**
       * Every template that exists, so a selection can be made from this one
       * response rather than guessed at.
       */
      available_template_names: [...templateNameCounts.keys()].sort(),
      template_history: {
        runs_with_history: recovered.length,
        runs_without_history: rows.length - recovered.length,
        distinct_template_sets: distinctSets.size,
      },
      summary: [
        `Would re-send ${selected.length} parked run(s) to the partner they came from`,
        recovered.length
          ? `Recovered last-dispatch templates for ${recovered.length}/${rows.length} run(s) across ${distinctSets.size} distinct set(s): ${rows
              .filter((r) => r.previous_template_names.length)
              .map(
                (r) =>
                  `${r.production_run_id} → ${r.previous_template_names.join(", ")}`
              )
              .join("; ")}`
          : `No previous templates recoverable for any run`,
        // Stated in BOTH directions: silence about a per-run mismatch is how a
        // batch-wide list gets applied to runs that never used it.
        distinctSets.size > 1 && body.template_names?.length
          ? `⚠️ An explicit template_names OVERRIDES all of them, and these runs did NOT agree — ${distinctSets.size} different sets. Use use_previous_templates:true to send each run back with its own.`
          : "",
        !usePrevious && !body.template_names?.length && recovered.length
          ? `Pass use_previous_templates:true to dispatch each run with its own recovered set, or template_names to override all of them.`
          : "",
        ambiguous.length
          ? `⚠️ ${ambiguous.length} run(s) reference a template name that matches MORE THAN ONE template (${[
              ...new Set(ambiguous.flatMap((r) => r.ambiguous_template_names)),
            ].join(
              ", "
            )}). Dispatch resolves by name, so it may instantiate the other one — check before confirming.`
          : "",
        stillAwaiting.length
          ? `${stillAwaiting.length} run(s) would be left awaiting a template selection`
          : "",
        orphaned.length
          ? `${orphaned.length} skipped with no previous partner`
          : "",
        deferred.length ? `${deferred.length} held back by limit` : "",
      ]
        .filter(Boolean)
        .join(". "),
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

      // Per run, from ITS OWN history — never a set pooled across the batch.
      const resolved = resolveDispatchTemplates(
        historyByRun.get(run.id) ?? {
          templates: [],
          source: "none",
          ambiguous_names: [],
        },
        { explicit: body.template_names, usePrevious }
      )

      let dispatched = false
      if (resolved.template_names.length && transactionId) {
        await engine.setStepSuccess({
          idempotencyKey: {
            action: TransactionHandlerType.INVOKE,
            transactionId,
            stepId: waitDispatchTemplateSelectionStepId,
            workflowId: dispatchProductionRunWorkflowId,
          },
          stepResponse: new StepResponse({
            template_names: resolved.template_names,
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
        template_names: resolved.template_names,
        template_source: resolved.source,
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
