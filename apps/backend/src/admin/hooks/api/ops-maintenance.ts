import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { sdk } from "../../lib/config"
import { queryKeysFactory } from "../../lib/query-key-factory"

/**
 * Admin Ops "data-plumbing" maintenance-jobs API hooks (#457 / #485).
 * Thin react-query wrappers over the guarded job registry endpoints so the
 * Settings → Data Plumbing console can list jobs, dry-run/apply them, and read
 * the durable run history. Mirrors the existing admin hook style (sdk.client).
 */

export type MaintenanceJobParam = {
  name: string
  type: "string" | "number" | "boolean"
  required: boolean
  description: string
}

export type MaintenanceJobSummary = {
  id: string
  label: string
  description: string
  params: MaintenanceJobParam[]
}

export type MaintenanceChange = {
  entity: string
  id: string
  field?: string
  before?: unknown
  after?: unknown
}

export type MaintenanceJobResult = {
  job_id: string
  dry_run: boolean
  applied: boolean
  summary: string
  changes: MaintenanceChange[]
  errors?: Array<{ id: string; message: string }>
}

export type RunJobResponse = {
  result: MaintenanceJobResult
  audit: {
    actor_id: string
    job_id: string
    dry_run: boolean
    applied: boolean
    change_count: number
    ran_at: string
  }
}

export type MaintenanceRun = {
  id: string
  job_id: string
  actor_id: string
  dry_run: boolean
  applied: boolean
  change_count: number
  error_count: number
  summary: string
  params: Record<string, unknown>
  changes: MaintenanceChange[]
  errors: Array<{ id: string; message: string }>
  /** Parent batch id when this run executed as part of a batch (#508); null for single-job runs. */
  batch_id?: string | null
  /** Position of this run within its batch, in execution order (#508). */
  job_index?: number
  created_at: string
  updated_at: string
}

export type ListJobsResponse = {
  jobs: MaintenanceJobSummary[]
  count: number
}

export type ListRunsResponse = {
  runs: MaintenanceRun[]
  count: number
  limit: number
  offset: number
}

export type RunsQuery = {
  limit?: number
  offset?: number
  job_id?: string
  dry_run?: boolean
  applied?: boolean
  /**
   * Scope to a batch's child runs (#508). Pass a batch id for that batch's
   * children, or `"null"`/`"none"` for single-job runs only (`batch_id IS NULL`)
   * so the "All runs" tab doesn't double-list runs already shown under a batch.
   */
  batch_id?: string
}

/**
 * A batch parent record — one `POST /admin/ops/maintenance-jobs/batches` call
 * that ran several jobs sequentially under one named run (Data Plumbing v2,
 * #508). Mirrors the `ops_maintenance_batch` model columns. The parent stores
 * its own rollup, so the history list never re-aggregates the child runs.
 */
export type MaintenanceBatch = {
  id: string
  name: string
  actor_id: string
  dry_run: boolean
  stop_on_error: boolean
  job_count: number
  applied_count: number
  failed_count: number
  change_count: number
  error_count: number
  summary: string
  created_at: string
  updated_at: string
}

export type ListBatchesResponse = {
  batches: MaintenanceBatch[]
  count: number
  limit: number
  offset: number
}

export type BatchesQuery = {
  limit?: number
  offset?: number
  dry_run?: boolean
  actor_id?: string
}

/**
 * Per-batch detail: the parent rollup + its child `ops_maintenance_run` rows in
 * `job_index` order (the order the jobs ran). The children carry their own
 * per-entity `changes`/`errors`, so the detail view renders the grouped/card ↔
 * table views without a second call.
 */
export type BatchDetailResponse = {
  batch: MaintenanceBatch
  jobs: MaintenanceRun[]
}

const OPS_MAINTENANCE_QUERY_KEY = "ops_maintenance_jobs" as const
export const opsMaintenanceQueryKeys = queryKeysFactory(
  OPS_MAINTENANCE_QUERY_KEY
)

export const useMaintenanceJobs = () => {
  const { data, ...rest } = useQuery({
    queryKey: opsMaintenanceQueryKeys.list("jobs"),
    queryFn: async () =>
      sdk.client.fetch<ListJobsResponse>("/admin/ops/maintenance-jobs", {
        method: "GET",
      }),
  })

  return { ...rest, jobs: data?.jobs ?? [], count: data?.count ?? 0 }
}

export const useMaintenanceRuns = (query: RunsQuery = {}) => {
  const { data, ...rest } = useQuery({
    queryKey: opsMaintenanceQueryKeys.list(["runs", query]),
    queryFn: async () =>
      sdk.client.fetch<ListRunsResponse>("/admin/ops/maintenance-jobs/runs", {
        method: "GET",
        query: query as Record<string, unknown>,
      }),
  })

  return {
    ...rest,
    runs: data?.runs ?? [],
    count: data?.count ?? 0,
  }
}

/**
 * Batch-run history index (Data Plumbing v2, #508). One row per batch, newest
 * first, filterable by dry_run / actor_id. Mirrors `useMaintenanceRuns`.
 */
export const useMaintenanceBatches = (query: BatchesQuery = {}) => {
  const { data, ...rest } = useQuery({
    queryKey: opsMaintenanceQueryKeys.list(["batches", query]),
    queryFn: async () =>
      sdk.client.fetch<ListBatchesResponse>(
        "/admin/ops/maintenance-jobs/batches",
        {
          method: "GET",
          query: query as Record<string, unknown>,
        }
      ),
  })

  return {
    ...rest,
    batches: data?.batches ?? [],
    count: data?.count ?? 0,
  }
}

/**
 * Per-batch detail — the parent rollup + its child runs (#508). `enabled` is
 * gated on `id`, so this is a no-op until a batch is selected in the history.
 */
export const useMaintenanceBatch = (id: string | undefined) => {
  const { data, ...rest } = useQuery({
    queryKey: opsMaintenanceQueryKeys.detail(id ?? "none"),
    queryFn: async () =>
      sdk.client.fetch<BatchDetailResponse>(
        `/admin/ops/maintenance-jobs/batches/${id}`,
        {
          method: "GET",
        }
      ),
    enabled: !!id,
  })

  return {
    ...rest,
    batch: data?.batch,
    jobs: data?.jobs ?? [],
  }
}

export const useRunMaintenanceJob = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      dry_run,
      params,
    }: {
      id: string
      dry_run: boolean
      params?: Record<string, unknown>
    }) =>
      sdk.client.fetch<RunJobResponse>(
        `/admin/ops/maintenance-jobs/${id}/run`,
        {
          method: "POST",
          body: { dry_run, params: params ?? {} },
        }
      ),
    onSuccess: (_res, vars) => {
      // Only an applied (non-dry) run mutates server state + writes a run row.
      if (!vars.dry_run) {
        queryClient.invalidateQueries({
          queryKey: opsMaintenanceQueryKeys.lists(),
        })
      }
    },
  })
}
