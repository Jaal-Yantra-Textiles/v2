import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import { TASKS_MODULE } from "../../../../modules/tasks"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — rewind a production run that was completed prematurely.
 *
 * A partner can drive a run accept → start → finish → complete in seconds
 * without recording what they made: `produced_quantity` is optional at
 * completion, and nothing gates completing on the run's own checklist. The run
 * then reads "completed" while its output is null, its material unlogged and
 * its subtasks unfinished — and there has never been a way back. Reassignment
 * rewinds `dispatch_state`, but its policy refuses once the partner accepted,
 * which is long past by then.
 *
 * This puts the run back where the partner can do it properly. It is a
 * LIFECYCLE rewind, not an undo of everything completion caused — see the
 * side-effect guard below, which is the whole reason this job is careful rather
 * than a three-line update.
 */

/** Statuses a rewind may target, ordered earliest-first. */
const REWIND_TARGETS = ["approved", "sent_to_partner", "in_progress"] as const
type RewindTarget = (typeof REWIND_TARGETS)[number]

/** Task statuses that count as "closed" and therefore reopenable by a rewind. */
const CLOSED_TASK_STATUSES = new Set(["completed", "cancelled"])

const paramsSchema = z.object({
  production_run_id: z.string().min(1),
  /** Where to rewind to. Default `in_progress` — the partner picks up mid-run. */
  to_status: z.enum(REWIND_TARGETS).optional(),
  /** Also rewind the parent run when the child's completion cascaded into it. */
  rewind_parent: z.boolean().optional(),
  /** Reopen tasks that completion force-closed. Default true. */
  reopen_tasks: z.boolean().optional(),
  /**
   * Proceed even though completion left side effects a re-completion would
   * duplicate (consumption logs). Off by default, deliberately.
   */
  force: z.boolean().optional(),
})

/**
 * Which lifecycle stamps a rewind to `target` must clear.
 *
 * Pure so the decision is testable without a container. Ordering matters:
 * rewinding to `in_progress` keeps `accepted_at`/`started_at` (the partner did
 * accept and did start), while rewinding further back clears them too — a run
 * sitting at `approved` with an `accepted_at` would be read as accepted by
 * every policy check that looks at the stamp rather than the status.
 */
export function fieldsToClearForRewind(target: RewindTarget): string[] {
  const always = [
    "finished_at",
    "completed_at",
    "produced_quantity",
    "rejected_quantity",
    "rejection_reason",
    "rejection_notes",
    "completion_notes",
    "finish_notes",
  ]

  if (target === "in_progress") {
    return always
  }
  if (target === "sent_to_partner") {
    return [...always, "accepted_at", "started_at"]
  }
  // approved — before dispatch, so the dispatch cycle rewinds too.
  return [
    ...always,
    "accepted_at",
    "started_at",
    "dispatch_state",
    "dispatch_started_at",
    "dispatch_completed_at",
  ]
}

/**
 * The diff a rewind would make to one run.
 *
 * `dispatch_state` is a non-nullable enum, so it rewinds to "idle" rather than
 * null — the same value `assignProductionRunPartner` uses when it puts a run
 * back in the dispatchable state.
 */
export function planRunRewind(
  run: Record<string, any>,
  target: RewindTarget
): MaintenanceChange[] {
  const changes: MaintenanceChange[] = []

  if (String(run.status) !== target) {
    changes.push({
      entity: "production_run",
      id: run.id,
      field: "status",
      before: run.status ?? null,
      after: target,
    })
  }

  for (const field of fieldsToClearForRewind(target)) {
    const before = run[field] ?? null
    const after = field === "dispatch_state" ? "idle" : null
    if (before === after) {
      continue
    }
    changes.push({
      entity: "production_run",
      id: run.id,
      field,
      before,
      after,
    })
  }

  return changes
}

export const rewindProductionRunJob: MaintenanceJob = {
  id: "rewind-production-run",
  label: "Rewind a prematurely completed production run",
  description:
    "Put a run that was marked complete without its data back where the partner can finish it properly — clears the completion stamps and output, reopens the tasks completion force-closed, and re-mirrors the unified order. Refuses when completion left consumption logs a re-completion would duplicate, unless forced. Does NOT reverse finished goods already stocked; those are reported so you can decide. Dry-run previews every field.",
  params: [
    {
      name: "production_run_id",
      type: "string",
      required: true,
      description: "The run to rewind, e.g. 'prod_run_01KWPVZ4R2PWK6DW1X8X5DKNZE'",
    },
    {
      name: "to_status",
      type: "string",
      required: false,
      description:
        "approved | sent_to_partner | in_progress (default). in_progress keeps accepted_at/started_at; earlier targets clear them too.",
    },
    {
      name: "rewind_parent",
      type: "boolean",
      required: false,
      description:
        "Also rewind the parent run, whose completion was cascaded from this child. Default false.",
    },
    {
      name: "reopen_tasks",
      type: "boolean",
      required: false,
      description:
        "Reopen tasks that completion force-closed, back to in_progress. Default true.",
    },
    {
      name: "force",
      type: "boolean",
      required: false,
      description:
        "Proceed despite consumption logs that a re-completion would duplicate. Default false.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      )
    }
    const {
      production_run_id: runId,
      rewind_parent: rewindParent = false,
      force = false,
    } = parsed.data
    const target: RewindTarget = parsed.data.to_status ?? "in_progress"
    const reopenTasks = parsed.data.reopen_tasks ?? true

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
    const consumptionService: any = container.resolve(CONSUMPTION_LOG_MODULE)
    const taskService: any = container.resolve(TASKS_MODULE)

    const run = await runService.retrieveProductionRun(runId).catch(() => null)
    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${runId} not found`
      )
    }
    if (run.deleted_at) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Production run ${runId} is deleted — restore it before rewinding`
      )
    }
    if (run.cancelled_at) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Production run ${runId} is cancelled, not completed — rewinding would resurrect it. Use reassignment instead.`
      )
    }

    // A re-completion re-runs logConsumptionsStep, so logs already attached to
    // this run would be written twice. Nothing here can tell an intended log
    // from a duplicate, so this is the operator's call, not ours.
    const [existingLogs] = await consumptionService.listAndCountConsumptionLogs(
      { production_run_id: runId },
      { take: null }
    )
    const logCount = (existingLogs || []).length
    if (logCount > 0 && !force) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Run ${runId} already has ${logCount} consumption log(s). Completing it again would log the material a second time. Delete or reconcile them first, or pass force:true if you have already accounted for that.`
      )
    }

    const changes: MaintenanceChange[] = planRunRewind(run, target)

    // Parent runs complete by cascade from the child, so a child rewind leaves
    // a parent claiming goods that are no longer finished.
    const parentId = run.parent_run_id ?? null
    let parent: any = null
    if (rewindParent && parentId) {
      parent = await runService.retrieveProductionRun(parentId).catch(() => null)
      if (parent && !parent.cancelled_at && !parent.deleted_at) {
        changes.push(...planRunRewind(parent, target))
      }
    }

    // Tasks the completion force-closed. Read through the run↔task link so a
    // task that was never linked is left alone rather than guessed at by title.
    let taskChanges: Array<{ id: string; before: string }> = []
    if (reopenTasks) {
      const { data: runData } = await query.graph({
        entity: "production_runs",
        fields: ["id", "tasks.id", "tasks.status", "tasks.title"],
        filters: { id: runId },
      })
      const linked = ((runData?.[0] as any)?.tasks || []) as any[]
      taskChanges = linked
        .filter((t) => t?.id && CLOSED_TASK_STATUSES.has(String(t.status || "")))
        .map((t) => ({ id: t.id, before: String(t.status) }))

      for (const t of taskChanges) {
        changes.push({
          entity: "task",
          id: t.id,
          field: "status",
          before: t.before,
          after: "in_progress",
        })
      }
    }

    if (!dry_run && changes.length > 0) {
      const clearFor = (r: Record<string, any>) =>
        Object.fromEntries(
          fieldsToClearForRewind(target).map((f) => [
            f,
            f === "dispatch_state" ? "idle" : null,
          ])
        )

      await runService.updateProductionRuns({
        id: run.id,
        status: target,
        ...clearFor(run),
      })

      if (parent) {
        await runService.updateProductionRuns({
          id: parent.id,
          status: target,
          ...clearFor(parent),
        })
      }

      for (const t of taskChanges) {
        await taskService
          .updateTasks({ id: t.id, status: "in_progress" })
          .catch(() => {
            // A task that refuses to reopen must not strand the run rewind that
            // already committed — the run state is what the partner acts on.
          })
      }

      // Audit on the run's own timeline, not only in the ops log: the admin run
      // page is where anyone asking "why is this open again" will look.
      await runService
        .createProductionRunActivities({
          production_run_id: run.id,
          activity_type: "lifecycle_event",
          kind: "rewound",
          actor_type: "system",
          actor_id: null,
          partner_id: run.partner_id ?? null,
          channel: null,
          message_id: null,
          template_name: null,
          recipient: null,
          summary: `Run rewound to ${target} for re-completion`,
          payload: {
            from_status: run.status ?? null,
            to_status: target,
            tasks_reopened: taskChanges.length,
            forced: force,
          },
          occurred_at: new Date(),
        } as any)
        .catch(() => {
          // Timeline write is a record, not the act.
        })
    }

    const notes: string[] = []
    if (logCount > 0) {
      notes.push(
        `⚠️ ${logCount} consumption log(s) already attached — re-completing will log material again unless you clear them`
      )
    }
    if (parentId && !rewindParent) {
      notes.push(
        `parent ${parentId} left as-is (pass rewind_parent:true if its completion cascaded from this run)`
      )
    }
    // Completion stocks finished goods, and nothing here reverses that. Say so
    // rather than let a silent double-count arrive at the next completion.
    notes.push(
      "finished goods stocked at completion are NOT reversed — check the partner location's levels before the run is completed again"
    )

    const summary = [
      `${dry_run ? "Would rewind" : "Rewound"} run ${runId} from ${
        run.status
      } to ${target}${parent ? ` (and parent ${parent.id})` : ""}`,
      taskChanges.length
        ? `${dry_run ? "would reopen" : "reopened"} ${taskChanges.length} task(s)`
        : "no closed tasks to reopen",
      ...notes,
    ].join(". ")

    return {
      job_id: rewindProductionRunJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}
