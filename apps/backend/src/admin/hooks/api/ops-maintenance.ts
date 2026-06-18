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
