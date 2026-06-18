import { MedusaError } from "@medusajs/framework/utils"

import { getMaintenanceJob } from "./registry"
import type { MaintenanceJobResult } from "./registry"
import type { BatchChildOutcome } from "./batch-audit"

/**
 * One job spec inside a batch run (Data Plumbing v2, #508) — a registry job id
 * plus its (already object-validated) params. The per-job param shape is
 * validated by the job's own zod schema when it runs.
 */
export type BatchJobSpec = {
  job_id: string
  params: Record<string, unknown>
}

/**
 * Single-job runner signature. Injected into `runBatch` so the sequential
 * executor (the part that MUST catch per-job errors) is unit-testable without
 * booting the container, the registry, or any real job. (#508)
 */
export type RunSingleJob = (
  container: any,
  jobId: string,
  opts: { dry_run: boolean; params: Record<string, unknown> }
) => Promise<MaintenanceJobResult>

/**
 * Default runner: resolve the job from the registry and run it. A genuinely
 * unknown id throws NOT_FOUND (the batch route validates ids up front, so this
 * is a defensive fallback only).
 */
export const defaultRunSingleJob: RunSingleJob = async (
  container,
  jobId,
  opts
) => {
  const job = getMaintenanceJob(jobId)
  if (!job) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown maintenance job: ${jobId}`
    )
  }
  return job.run(container, opts)
}

/**
 * Run a batch of maintenance jobs SEQUENTIALLY under a single batch-level
 * `dry_run`. Each child runs in order; a child that throws (e.g. a per-job
 * `MedusaError` from a bad id or invalid param) is CAUGHT and recorded as a
 * failed outcome — it does NOT abort the request the way the single-job
 * `:id/run` route does. This is the core #508 contract: one bad job never sinks
 * the whole batch.
 *
 * With `stop_on_error=true` the loop halts after the first failure (for ordered
 * / dependent batches); the already-attempted outcomes are still returned. With
 * the default `stop_on_error=false` every job is attempted regardless.
 *
 * Returns the per-child outcomes in execution order; the caller rolls them up
 * (`buildBatchRollup`) and persists the parent + child audit rows.
 */
export async function runBatch(
  container: any,
  opts: {
    jobs: BatchJobSpec[]
    dry_run: boolean
    stop_on_error: boolean
    /** Injectable for unit testing — defaults to the registry-backed runner. */
    runJob?: RunSingleJob
  }
): Promise<BatchChildOutcome[]> {
  const runJob = opts.runJob ?? defaultRunSingleJob
  const outcomes: BatchChildOutcome[] = []

  for (const spec of opts.jobs) {
    try {
      const result = await runJob(container, spec.job_id, {
        dry_run: opts.dry_run,
        params: spec.params,
      })
      outcomes.push({ job_id: spec.job_id, ok: true, result })
    } catch (e: any) {
      outcomes.push({
        job_id: spec.job_id,
        ok: false,
        error: e?.message ?? String(e),
      })
      if (opts.stop_on_error) break
    }
  }

  return outcomes
}
