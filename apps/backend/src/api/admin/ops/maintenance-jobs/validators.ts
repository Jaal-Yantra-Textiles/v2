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
