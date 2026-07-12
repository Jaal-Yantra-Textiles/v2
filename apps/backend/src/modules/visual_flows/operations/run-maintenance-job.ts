import { z } from "@medusajs/framework/zod"
import { OperationDefinition, OperationContext, OperationResult } from "./types"
import { interpolateVariables } from "./utils"

/**
 * run_maintenance_job — run any registered Data-Plumbing maintenance job as a
 * visual-flow node, in-process (#450/#916 winback automation).
 *
 * WHY an in-process op (not a `trigger_workflow` node): maintenance jobs are
 * registry objects (`getMaintenanceJob(id).run(container, {dry_run, params})`),
 * not Medusa workflows — a `trigger_workflow` node can't call them. And even for
 * a wrapping workflow, prod runs the REDIS workflow engine, so `trigger_workflow`
 * returns before the workflow finishes and the node can't capture the result or
 * surface the error. Running the job here (mirrors `marketing_daily_ideas_email`)
 * is synchronous: the job's summary/changes land in the data chain and a thrown
 * job error fails the node cleanly.
 *
 * This is GENERIC — pair it with a schedule-trigger node to run ANY maintenance
 * job periodically (winback target generation, backfills, recomputes, …). The
 * registry is imported lazily at execute time so this op module doesn't pull the
 * large registry into the load graph.
 *
 * Node output (the job result): { job_id, dry_run, applied, summary, changes,
 *   errors? } plus a convenience `changed` scalar for downstream conditions.
 */

export const runMaintenanceJobOptionsSchema = z.object({
  /** Registry id of the maintenance job to run (e.g. "generate-winback-targets"). */
  job_id: z.string(),
  /**
   * When false (the default here) the job APPLIES its writes idempotently. Set
   * true to preview only. Accepts a `{{ variable }}` string resolving to a
   * boolean-ish value. NOTE: this default is the inverse of the HTTP run route
   * (which defaults dry_run:true) — a scheduled node exists to actually apply.
   */
  dry_run: z.union([z.boolean(), z.string()]).optional(),
  /** Optional job params (object, or a `{{ variable }}` string resolving to one). */
  params: z.union([z.record(z.string(), z.any()), z.string()]).optional(),
})

export type RunMaintenanceJobOptions = z.infer<
  typeof runMaintenanceJobOptionsSchema
>

/**
 * Coerce a resolved `dry_run` option to a boolean, defaulting to FALSE (apply).
 * Pure/unit-testable. Mirrors the truthy vocabulary used elsewhere in the flow
 * ops ("true"/"1"/"yes"/"on" → true; everything else → false).
 */
export function resolveDryRunOption(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (value === undefined || value === null || value === "") return false
  const raw = String(value).trim().toLowerCase()
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on"
}

/** Normalize a resolved `params` option into a plain object. */
export function normalizeParamsOption(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Non-JSON string → no params.
    }
  }
  return {}
}

export const runMaintenanceJobOperation: OperationDefinition = {
  type: "run_maintenance_job",
  name: "Run Maintenance Job",
  description:
    "Run a registered Data-Plumbing maintenance job by id (e.g. generate-winback-targets). Pair with a schedule-trigger node to run it periodically. Defaults to APPLY (dry_run:false); set dry_run to preview. The job's summary + changes land in the data chain.",
  icon: "bolt",
  category: "utility",
  optionsSchema: runMaintenanceJobOptionsSchema,

  defaultOptions: { dry_run: false },

  execute: async (
    options: any,
    context: OperationContext
  ): Promise<OperationResult> => {
    try {
      const parsed = runMaintenanceJobOptionsSchema.parse(options ?? {})

      // Interpolate {{ variable }} references BEFORE interpreting the values
      // (reference_visual_flow_template_items_resolution).
      const jobId = String(
        interpolateVariables(parsed.job_id, context.dataChain)
      ).trim()
      if (!jobId) {
        return { success: false, error: "run_maintenance_job requires a job_id" }
      }
      const dryRun = resolveDryRunOption(
        parsed.dry_run !== undefined
          ? interpolateVariables(parsed.dry_run, context.dataChain)
          : undefined
      )
      const params = normalizeParamsOption(
        parsed.params !== undefined
          ? interpolateVariables(parsed.params, context.dataChain)
          : undefined
      )

      // Lazy import so this op module doesn't pull the (large) registry into the
      // load graph — it's only needed when the node actually runs.
      const { getMaintenanceJob } = await import(
        "../../../api/admin/ops/maintenance-jobs/registry.js"
      )
      const job = getMaintenanceJob(jobId)
      if (!job) {
        return { success: false, error: `Unknown maintenance job: ${jobId}` }
      }

      const result = await job.run(context.container, {
        dry_run: dryRun,
        params,
      })

      return {
        success: true,
        data: {
          ...result,
          // Convenience scalar for a downstream condition node.
          changed: Array.isArray(result?.changes) ? result.changes.length > 0 : false,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message ?? "Failed to run maintenance job",
        errorStack: error?.stack,
      }
    }
  },
}
