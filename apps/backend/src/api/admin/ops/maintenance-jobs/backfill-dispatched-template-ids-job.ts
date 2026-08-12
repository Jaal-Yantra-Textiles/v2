import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import productionRunsTasksLink from "../../../../links/production-runs-tasks"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { TASKS_MODULE } from "../../../../modules/tasks"
import type TaskService from "../../../../modules/tasks/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — give already-dispatched runs the record #1265 added.
 *
 * `dispatched_template_ids` is written by dispatch from now on, but every run
 * dispatched BEFORE it existed has none — including the six re-dispatched on
 * prod on 2026-08-12. Their tasks still carry the answer: `createTaskWithTemplates`
 * stamps `template_id` on each task it instantiates. This copies that answer onto
 * the run, so it survives the tasks being deleted.
 *
 * ⚠️ This writes a record of something that already happened. It changes no
 * dispatch, creates no task, and sends nothing to a partner.
 *
 * Refuses a PARTIAL answer. If a run has a task that names a template but does
 * not identify one, the run is skipped and reported rather than recorded with
 * the ids that were identified — the same rule #1262 applies to dispatching
 * recovered history, and for the same reason: a short list claims the run ran a
 * shorter process than it did. Skipping leaves the tasks as the evidence, which
 * is exactly where things stood before.
 *
 * Never overwrites a run that already has a record. Safe to re-run.
 */
const paramsSchema = z.object({
  /** One run, for a spot check before a full pass. */
  production_run_id: z.string().min(1).optional(),
  /** Bound a first pass; omitted means every run that needs one. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

type TaskStamp = { template_id?: unknown; template_name?: unknown }

/**
 * PURE: what the tasks say this run was dispatched with. Exported for tests.
 *
 * Order is the order the partner works in, deduped — the same reading
 * `recoverRunTemplates` takes. The parent `production-run-<id>` task carries no
 * stamp at all and is skipped: absence there is structure, not loss.
 */
export function deriveDispatchedTemplateIds(tasks: Array<{ metadata?: TaskStamp | null }>): {
  ids: string[]
  unidentified: string[]
} {
  const ids: string[] = []
  const seen = new Set<string>()
  const unidentified: string[] = []

  for (const t of tasks ?? []) {
    const md = (t?.metadata ?? {}) as TaskStamp
    const name = typeof md.template_name === "string" ? md.template_name : ""
    if (!name.length) {
      continue
    }

    const id = typeof md.template_id === "string" ? md.template_id : ""
    if (!id.length) {
      // Named a template but did not identify one — the run's answer is partial.
      unidentified.push(name)
      continue
    }

    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }

  return { ids, unidentified }
}

export const backfillDispatchedTemplateIdsJob: MaintenanceJob = {
  id: "backfill-dispatched-template-ids",
  label: "Record what already-dispatched runs were dispatched with",
  description:
    "Copy each run's dispatched template IDS from the tasks it already has onto the run itself (#1265). Runs dispatched before that field existed have no record, so the only evidence of what they ran is their tasks — archaeology every time, and gone entirely if the tasks are deleted. Writes a record of something that ALREADY HAPPENED: it changes no dispatch, creates no task, and sends nothing to a partner. A run whose tasks name a template without identifying one is SKIPPED and reported, never recorded with a partial list — a short list would claim the run ran a shorter process than it did. Never overwrites a run that already has a record. Safe to re-run: a no-op once every dispatched run has one.",
  params: [
    {
      name: "production_run_id",
      type: "string",
      required: false,
      description: "Only this run, e.g. for a spot check before a full pass.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many runs. Omit for every run that needs one.",
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

    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const [allRuns] = await runService.listAndCountProductionRuns(
      parsed.data.production_run_id
        ? { id: parsed.data.production_run_id }
        : {},
      { take: null }
    )

    if (parsed.data.production_run_id && !(allRuns || []).length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${parsed.data.production_run_id} not found`
      )
    }

    // Only runs with nothing recorded. An existing record was written BY a
    // dispatch and is better evidence than anything derived here.
    const candidates = (allRuns || []).filter(
      (r: any) => !((r?.dispatched_template_ids ?? []) as string[]).length
    )

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    const skippedPartial: Array<{ id: string; names: string[] }> = []
    let noTasks = 0

    for (const run of candidates) {
      if (parsed.data.limit && changes.length >= parsed.data.limit) {
        break
      }

      try {
        const { data: links } = await query.graph({
          entity: productionRunsTasksLink.entryPoint,
          fields: ["task_id"],
          filters: { production_runs_id: run.id },
        })
        const taskIds = (links || []).map((l: any) => l?.task_id).filter(Boolean)

        if (!taskIds.length) {
          // Never dispatched, or its tasks are already gone. Either way there is
          // nothing to copy — and inventing an empty record would claim it was
          // dispatched with nothing.
          noTasks++
          continue
        }

        const tasks = await (taskService as any).listTasks(
          { id: taskIds } as any,
          { take: null }
        )

        const { ids, unidentified } = deriveDispatchedTemplateIds(tasks || [])

        if (unidentified.length) {
          skippedPartial.push({ id: run.id, names: [...new Set(unidentified)] })
          continue
        }

        if (!ids.length) {
          noTasks++
          continue
        }

        changes.push({
          entity: "production_run",
          id: run.id,
          field: "dispatched_template_ids",
          before: null,
          after: ids,
        })

        if (!dry_run) {
          await runService.updateProductionRuns({
            id: run.id,
            dispatched_template_ids: ids,
          })
        }
      } catch (e: any) {
        // One unreadable run must not strand the rest of the pass.
        errors.push({ id: run.id, message: e?.message ?? String(e) })
      }
    }

    const summary = [
      changes.length
        ? `${dry_run ? "Would record" : "Recorded"} dispatched templates for ${
            changes.length
          } run(s): ${changes
            .map((c) => `${c.id} → ${(c.after as string[]).join(", ")}`)
            .join("; ")}`
        : `No run needs a dispatched-template record (${
            (allRuns || []).length
          } run(s) checked, ${candidates.length} without one)`,
      // Stated even at zero: silence would read as "every run was covered",
      // which is the claim this job must never make by omission.
      `${noTasks} run(s) had no template-stamped tasks to copy from — never dispatched, or their tasks are gone.`,
      skippedPartial.length
        ? `⚠️ ${skippedPartial.length} run(s) SKIPPED: their tasks name a template without identifying one, so the answer would be partial — ${skippedPartial
            .map((s) => `${s.id} (${s.names.join(", ")})`)
            .join("; ")}. Their tasks remain the evidence, as before.`
        : null,
      errors.length ? `${errors.length} run(s) could not be read.` : null,
    ]
      .filter(Boolean)
      .join(" ")

    return {
      job_id: "backfill-dispatched-template-ids",
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
