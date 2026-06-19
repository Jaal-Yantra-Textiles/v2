import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Button,
  Input,
  Label,
  Select,
  Switch,
  DataTable,
  DataTablePaginationState,
  DataTableFilteringState,
  createDataTableFilterHelper,
  useDataTable,
  Drawer,
  Skeleton,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Tools } from "@medusajs/icons"
import { createColumnHelper } from "@tanstack/react-table"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import {
  useMaintenanceJobs,
  useMaintenanceRuns,
  useRunMaintenanceJob,
  type MaintenanceJobSummary,
  type MaintenanceJobResult,
  type MaintenanceRun,
} from "../../../hooks/api/ops-maintenance"
import { ChangesTable, RunBadge } from "./components"

/**
 * Settings → Data Plumbing (#457 / #485 / #508).
 *
 * Operator console over the guarded maintenance-jobs registry, structured like
 * every other admin list page: the root is a single DataTable of the durable run
 * history (newest first) that you click into for a per-run detail route. A
 * "Run a job" header action opens a drawer to pick a job, fill its params,
 * PREVIEW (dry-run, no writes) then APPLY (confirmed). Job list and history are
 * backend-driven, so new registry jobs and new runs appear automatically.
 */

type ParamValues = Record<string, string>

/** The job picker + param form + preview/apply, rendered inside the run drawer. */
const JobRunner = ({ job }: { job: MaintenanceJobSummary }) => {
  const prompt = usePrompt()
  const runJob = useRunMaintenanceJob()
  const [values, setValues] = useState<ParamValues>({})
  const [result, setResult] = useState<MaintenanceJobResult | null>(null)

  const buildParams = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const p of job.params) {
      const raw = values[p.name]
      if (raw === undefined || raw === "") continue
      if (p.type === "number") out[p.name] = Number(raw)
      else if (p.type === "boolean") out[p.name] = raw === "true"
      else out[p.name] = raw
    }
    return out
  }

  const missingRequired = job.params
    .filter((p) => p.required)
    .filter((p) => !values[p.name])
    .map((p) => p.name)

  const run = async (dry_run: boolean) => {
    if (missingRequired.length) {
      toast.error(`Missing required param(s): ${missingRequired.join(", ")}`)
      return
    }

    if (!dry_run) {
      const ok = await prompt({
        title: `Apply ${job.label}?`,
        description:
          "This writes changes to the database. Run a dry-run first to preview. Continue?",
        confirmText: "Apply",
        cancelText: "Cancel",
      })
      if (!ok) return
    }

    try {
      const res = await runJob.mutateAsync({
        id: job.id,
        dry_run,
        params: buildParams(),
      })
      setResult(res.result)
      toast.success(
        dry_run
          ? `Dry-run: ${res.result.changes.length} change(s) previewed`
          : `Applied: ${res.result.changes.length} change(s)`
      )
    } catch (e: any) {
      toast.error(e?.message ?? "Job run failed")
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Text size="small" className="text-ui-fg-subtle">
        {job.description}
      </Text>

      {job.params.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {job.params.map((p) => (
            <div key={p.name} className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                {p.name}
                {p.required ? " *" : ""}
              </Label>
              {p.type === "boolean" ? (
                <div className="flex items-center gap-x-2">
                  <Switch
                    checked={values[p.name] === "true"}
                    onCheckedChange={(checked) =>
                      setValues((v) => ({
                        ...v,
                        [p.name]: checked ? "true" : "false",
                      }))
                    }
                  />
                  <Text size="small" className="text-ui-fg-subtle">
                    {values[p.name] === "true" ? "true" : "false"}
                  </Text>
                </div>
              ) : (
                <Input
                  type={p.type === "number" ? "number" : "text"}
                  value={values[p.name] ?? ""}
                  placeholder={p.required ? "required" : "optional"}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [p.name]: e.target.value }))
                  }
                />
              )}
              <Text size="xsmall" className="text-ui-fg-muted">
                {p.description}
              </Text>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-x-2">
        <Button
          variant="secondary"
          isLoading={runJob.isPending}
          onClick={() => run(true)}
        >
          Preview (dry-run)
        </Button>
        <Button
          variant="danger"
          isLoading={runJob.isPending}
          onClick={() => run(false)}
        >
          Apply
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-y-2 rounded-md border border-ui-border-base p-4">
          <div className="flex items-center gap-x-2">
            <RunBadge dry_run={result.dry_run} applied={result.applied} />
            <Text size="small" weight="plus">
              {result.summary}
            </Text>
          </div>
          <ChangesTable result={result} />
        </div>
      )}
    </div>
  )
}

/** "Run a job" drawer: select a registry job, then preview/apply it. */
const RunJobDrawer = () => {
  const { jobs, isLoading, isError } = useMaintenanceJobs()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedId),
    [jobs, selectedId]
  )

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSelectedId(undefined)
      }}
    >
      <Drawer.Trigger asChild>
        <Button size="small" variant="primary">
          Run
        </Button>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Run a maintenance job</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div className="flex flex-col gap-y-2">
            <Label size="small" weight="plus">
              Job
            </Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : isError ? (
              <Text size="small" className="text-ui-fg-error">
                Failed to load jobs.
              </Text>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <Select.Trigger>
                  <Select.Value placeholder="Select a maintenance job…" />
                </Select.Trigger>
                <Select.Content>
                  {jobs.map((j) => (
                    <Select.Item key={j.id} value={j.id}>
                      {j.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          </div>

          {selectedJob && <JobRunner key={selectedJob.id} job={selectedJob} />}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

const PAGE_SIZE = 20

const runColumnHelper = createColumnHelper<MaintenanceRun>()

// Filter ids map to real `/runs` query params: `job_id` directly, and a synthetic
// `state` that translates to the `dry_run`/`applied` booleans the API supports.
const runFilterHelper = createDataTableFilterHelper<{
  job_id: string
  state: string
}>()

/** CSV export of the currently-loaded run rows (no built-in export; client-side). */
const exportRunsCsv = (runs: MaintenanceRun[]) => {
  const header = [
    "created_at",
    "job_id",
    "state",
    "change_count",
    "error_count",
    "actor_id",
    "batch_id",
    "summary",
  ]
  const state = (r: MaintenanceRun) =>
    r.dry_run ? "dry-run" : r.applied ? "applied" : "no-op"
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const lines = [
    header.join(","),
    ...runs.map((r) =>
      [
        r.created_at,
        r.job_id,
        state(r),
        r.change_count,
        r.error_count,
        r.actor_id,
        r.batch_id ?? "",
        r.summary,
      ]
        .map(escape)
        .join(",")
    ),
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "data-plumbing-runs.csv"
  a.click()
  URL.revokeObjectURL(url)
}

const OpsDataPlumbingPage = () => {
  const navigate = useNavigate()
  const { jobs } = useMaintenanceJobs()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const filters = useMemo(
    () => [
      runFilterHelper.accessor("job_id", {
        type: "select",
        label: "Job",
        options: jobs.map((j) => ({ label: j.label, value: j.id })),
      }),
      runFilterHelper.accessor("state", {
        type: "select",
        label: "State",
        options: [
          { label: "Applied", value: "applied" },
          { label: "Dry-run", value: "dry-run" },
          { label: "No-op", value: "no-op" },
        ],
      }),
    ],
    [jobs]
  )

  // Translate the DataTable filter state into the `/runs` query params the API
  // supports (job_id directly; state → dry_run/applied booleans).
  const filterQuery = useMemo(() => {
    const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v)
    const q: Record<string, unknown> = {}
    const job = pick(filtering.job_id)
    if (job) q.job_id = job as string
    const state = pick(filtering.state)
    if (state === "dry-run") q.dry_run = true
    else if (state === "applied") q.applied = true
    else if (state === "no-op") {
      q.dry_run = false
      q.applied = false
    }
    return q
  }, [filtering])

  const offset = pagination.pageIndex * pagination.pageSize
  const { runs, count, isLoading } = useMaintenanceRuns({
    limit: pagination.pageSize,
    offset,
    ...filterQuery,
  })

  const columns = useMemo(
    () => [
      runColumnHelper.accessor("created_at", {
        header: "When",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap">
            {new Date(getValue()).toLocaleString()}
          </span>
        ),
      }),
      runColumnHelper.accessor("job_id", {
        header: "Job",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
      runColumnHelper.display({
        id: "state",
        header: "State",
        cell: ({ row }) => (
          <RunBadge
            dry_run={row.original.dry_run}
            applied={row.original.applied}
          />
        ),
      }),
      runColumnHelper.accessor("change_count", { header: "Changes" }),
      runColumnHelper.accessor("error_count", { header: "Errors" }),
      runColumnHelper.accessor("summary", {
        header: "Summary",
        cell: ({ getValue }) => (
          <span className="block max-w-[320px] truncate">{getValue()}</span>
        ),
      }),
      runColumnHelper.accessor("actor_id", {
        header: "Actor",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue()}</span>
        ),
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: runs,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    filtering: {
      state: filtering,
      onFilteringChange: (next) => {
        setFiltering(next)
        setPagination((p) => ({ ...p, pageIndex: 0 })) // reset to first page
      },
    },
    onRowClick: (_, row) =>
      navigate(`/settings/ops-data-plumbing/${row.id}`),
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col gap-y-4 px-6 py-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Heading>Data Plumbing</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Run guarded data-correction jobs. Always Preview (dry-run) before
              you Apply — dry-runs never write and are not logged; applied runs
              are recorded below. Click a run for its full change diff.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              variant="secondary"
              disabled={!runs.length}
              onClick={() => exportRunsCsv(runs)}
            >
              Export
            </Button>
            <RunJobDrawer />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table
          emptyState={{
            empty: {
              heading: "No runs yet",
              description:
                "Applied jobs are recorded here. Use “Run a job” to preview and apply one. (Dry-runs are not persisted.)",
            },
          }}
        />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export default OpsDataPlumbingPage

export const config = defineRouteConfig({
  label: "Data Plumbing",
  icon: Tools,
})

export const handle = {
  breadcrumb: () => "Data Plumbing",
}
