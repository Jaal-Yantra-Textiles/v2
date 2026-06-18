import { z } from "@medusajs/framework/zod"

/**
 * Body for POST /admin/ops/maintenance-jobs/:id/run.
 * dry_run defaults to true (safe by default) — the route applies the default
 * since validateAndTransformBody strips unknown keys but won't inject one.
 */
export const OpsMaintenanceRunSchema = z.object({
  dry_run: z.boolean().optional(),
  // Per-job params are validated inside each job's own schema; here we only
  // accept an object. NOTE: zod v4 requires the two-arg z.record form
  // (z.record(z.any()) leaves the value schema undefined → "_zod" crash when
  // params is non-empty).
  params: z.record(z.string(), z.any()).optional(),
})

export type OpsMaintenanceRunBody = z.infer<typeof OpsMaintenanceRunSchema>

/**
 * Query for GET /admin/ops/maintenance-jobs/runs (audit-log history). #457.
 * limit/offset are coerced from query strings; dry_run/applied accept the usual
 * "true"/"false" string forms.
 */
const booleanish = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true")

export const OpsMaintenanceRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  job_id: z.string().optional(),
  dry_run: booleanish.optional(),
  applied: booleanish.optional(),
})

export type OpsMaintenanceRunsQuery = z.infer<typeof OpsMaintenanceRunsQuerySchema>

/**
 * Hard cap on jobs per batch (Data Plumbing v2, #508). Each child job runs
 * synchronously in sequence, so we bound the per-request blast radius and keep
 * the endpoint responsive. Bigger corrections are split across batch calls.
 */
export const MAX_BATCH_JOBS = 20

/**
 * Body for POST /admin/ops/maintenance-jobs/batches (#508).
 *
 * Stateless "A2": one call runs + records the whole batch. Preview and Apply are
 * two separate calls with `dry_run` flipped (defaults to true — safe by
 * default). The batch is sequential with a single batch-level `dry_run`; a child
 * job that throws is CAUGHT and recorded (continue-on-error) unless
 * `stop_on_error=true`. Per-job `params` are validated inside each job's own
 * schema — here we only accept an object (same record() shape as the run route).
 */
export const OpsMaintenanceBatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  dry_run: z.boolean().optional(),
  stop_on_error: z.boolean().optional(),
  jobs: z
    .array(
      z.object({
        job_id: z.string().min(1, "job_id is required"),
        params: z.record(z.string(), z.any()).optional(),
      })
    )
    .min(1, "jobs must contain at least one job")
    .max(
      MAX_BATCH_JOBS,
      `jobs exceeds the per-batch limit of ${MAX_BATCH_JOBS}`
    ),
})

export type OpsMaintenanceBatchBody = z.infer<typeof OpsMaintenanceBatchSchema>

/**
 * Query for GET /admin/ops/maintenance-jobs/batches — batch-run history index
 * (Data Plumbing v2, #508). Paginated, newest first, filterable by
 * dry_run / actor_id (the batch parent has no single `applied` boolean — a batch
 * is an apply when `dry_run=false`). Mirrors the `/runs` reader envelope. Same
 * coercion shapes as OpsMaintenanceRunsQuerySchema.
 */
export const OpsMaintenanceBatchesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  dry_run: booleanish.optional(),
  actor_id: z.string().optional(),
})

export type OpsMaintenanceBatchesQuery = z.infer<
  typeof OpsMaintenanceBatchesQuerySchema
>
