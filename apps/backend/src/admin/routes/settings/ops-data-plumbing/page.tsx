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
  Badge,
  Table,
  Tabs,
  DataTable,
  DataTablePaginationState,
  useDataTable,
  Drawer,
  Skeleton,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Tools } from "@medusajs/icons"
import { createColumnHelper } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import {
  useMaintenanceJobs,
  useMaintenanceRuns,
  useMaintenanceBatches,
  useMaintenanceBatch,
  useRunMaintenanceJob,
  type MaintenanceJobSummary,
  type MaintenanceJobResult,
  type MaintenanceBatch,
} from "../../../hooks/api/ops-maintenance"
import { ChangesTable, RunBadge, BatchDetailView } from "./components"

/**
 * Settings → Data Plumbing (#457 / #485 / #508).
 *
 * Operator console over the guarded maintenance-jobs registry: pick a job, fill
 * its params, PREVIEW (dry-run, no writes) then APPLY (confirmed). The history
 * surface (Data Plumbing v2, #508) is a batch-first DataTable — click a batch to
 * open its detail drawer with a card ↔ table view toggle — plus an "All runs"
 * tab for single-job runs. The job list and history are backend-driven, so new
 * registry jobs and new runs appear automatically.
 */

type ParamValues = Record<string, string>

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
    <div className="flex flex-col gap-y-4 px-6 py-4">
      <div>
        <Text size="small" className="text-ui-fg-subtle">
          {job.description}
        </Text>
      </div>

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

const PAGE_SIZE = 20

const batchColumnHelper = createColumnHelper<MaintenanceBatch>()

/** CSV export of the currently-loaded batch rows (no built-in export; client-side). */
const exportBatchesCsv = (batches: MaintenanceBatch[]) => {
  const header = [
    "created_at",
    "name",
    "actor_id",
    "dry_run",
    "job_count",
    "applied_count",
    "failed_count",
    "change_count",
    "error_count",
    "summary",
  ]
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const lines = [
    header.join(","),
    ...batches.map((b) =>
      [
        b.created_at,
        b.name,
        b.actor_id,
        b.dry_run,
        b.job_count,
        b.applied_count,
        b.failed_count,
        b.change_count,
        b.error_count,
        b.summary,
      ]
        .map(escape)
        .join(",")
    ),
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "data-plumbing-batches.csv"
  a.click()
  URL.revokeObjectURL(url)
}

const BatchDetailDrawer = ({
  batchId,
  onClose,
}: {
  batchId: string | undefined
  onClose: () => void
}) => {
  const { batch, jobs, isLoading } = useMaintenanceBatch(batchId)

  return (
    <Drawer open={!!batchId} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{batch?.name ?? "Batch detail"}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !batch ? (
            <Text size="small" className="text-ui-fg-subtle">
              Batch not found.
            </Text>
          ) : (
            <div className="flex flex-col gap-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <RunBadge dry_run={batch.dry_run} applied={!batch.dry_run} />
                {batch.stop_on_error && (
                  <Badge color="orange" size="2xsmall">
                    stop-on-error
                  </Badge>
                )}
                <Text size="small" className="text-ui-fg-subtle">
                  {batch.job_count} job(s) · {batch.applied_count} applied ·{" "}
                  {batch.failed_count} failed · {batch.change_count} change(s)
                </Text>
              </div>
              <Text size="small" weight="plus">
                {batch.summary}
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                {new Date(batch.created_at).toLocaleString()} · {batch.actor_id}
              </Text>
              <BatchDetailView jobs={jobs} />
            </div>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

const BatchesHistory = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  })
  const [selectedBatchId, setSelectedBatchId] = useState<string | undefined>(
    undefined
  )

  const offset = pagination.pageIndex * pagination.pageSize

  const { batches, count, isLoading } = useMaintenanceBatches({
    limit: pagination.pageSize,
    offset,
  })

  const columns = useMemo(
    () => [
      batchColumnHelper.accessor("created_at", {
        header: "When",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap">
            {new Date(getValue()).toLocaleString()}
          </span>
        ),
      }),
      batchColumnHelper.accessor("name", { header: "Name" }),
      batchColumnHelper.accessor("job_count", { header: "Jobs" }),
      batchColumnHelper.accessor("applied_count", { header: "Applied" }),
      batchColumnHelper.accessor("failed_count", { header: "Failed" }),
      batchColumnHelper.accessor("change_count", { header: "Changes" }),
      batchColumnHelper.display({
        id: "state",
        header: "State",
        cell: ({ row }) => (
          <RunBadge
            dry_run={row.original.dry_run}
            applied={!row.original.dry_run}
          />
        ),
      }),
      batchColumnHelper.accessor("actor_id", {
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
    data: batches,
    getRowId: (row) => row.id,
    rowCount: count,
    isLoading,
    pagination: { state: pagination, onPaginationChange: setPagination },
    onRowClick: (_, row) => setSelectedBatchId(row.id),
  })

  if (!isLoading && !batches.length) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          No batches yet. Run several jobs as one batch to see them here.
          (Dry-runs are not persisted.)
        </Text>
      </div>
    )
  }

  return (
    <div className="py-2">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-6 py-2">
          <Text size="small" weight="plus">
            Batch history
          </Text>
          <Button
            variant="secondary"
            size="small"
            disabled={!batches.length}
            onClick={() => exportBatchesCsv(batches)}
          >
            Export CSV
          </Button>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
      <BatchDetailDrawer
        batchId={selectedBatchId}
        onClose={() => setSelectedBatchId(undefined)}
      />
    </div>
  )
}

const AllRunsHistory = () => {
  // Flat list of every persisted run (single-job + batch children). Once PR
  // #517's `GET /runs?batch_id=null` filter is merged this can pass
  // `batch_id: "null"` to drop batch children (which already appear, grouped,
  // under the Batches tab). Until then the route rejects the unknown param
  // (400), so we intentionally don't send it — minor double-listing over a
  // broken tab.
  const { runs, isLoading } = useMaintenanceRuns({ limit: 20 })

  if (isLoading) {
    return (
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (!runs.length) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          No single-job runs yet. (Dry-runs are not persisted.)
        </Text>
      </div>
    )
  }

  return (
    <div className="px-6 py-4">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>When</Table.HeaderCell>
            <Table.HeaderCell>Job</Table.HeaderCell>
            <Table.HeaderCell>State</Table.HeaderCell>
            <Table.HeaderCell>Changes</Table.HeaderCell>
            <Table.HeaderCell>Errors</Table.HeaderCell>
            <Table.HeaderCell>Summary</Table.HeaderCell>
            <Table.HeaderCell>Actor</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {runs.map((r) => (
            <Table.Row key={r.id}>
              <Table.Cell className="whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </Table.Cell>
              <Table.Cell className="font-mono text-xs">{r.job_id}</Table.Cell>
              <Table.Cell>
                <RunBadge dry_run={r.dry_run} applied={r.applied} />
              </Table.Cell>
              <Table.Cell>{r.change_count}</Table.Cell>
              <Table.Cell>{r.error_count}</Table.Cell>
              <Table.Cell className="max-w-[280px] truncate">
                {r.summary}
              </Table.Cell>
              <Table.Cell className="font-mono text-xs">{r.actor_id}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  )
}

const OpsDataPlumbingPage = () => {
  const { jobs, isLoading, isError } = useMaintenanceJobs()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedId),
    [jobs, selectedId]
  )

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Data Plumbing</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Run guarded data-correction jobs. Always Preview (dry-run) before you
          Apply — dry-runs never write and are not logged; applied runs are
          recorded in history below.
        </Text>
      </div>

      <Tabs defaultValue="run">
        <div className="px-6 pt-4">
          <Tabs.List>
            <Tabs.Trigger value="run">Run a job</Tabs.Trigger>
            <Tabs.Trigger value="batches">Batches</Tabs.Trigger>
            <Tabs.Trigger value="runs">All runs</Tabs.Trigger>
          </Tabs.List>
        </div>

        <Tabs.Content value="run">
          <div className="flex flex-col gap-y-2 px-6 py-4">
            <Label size="small" weight="plus">
              Job
            </Label>
            {isLoading ? (
              <Skeleton className="h-9 w-full max-w-md" />
            ) : isError ? (
              <Text size="small" className="text-ui-fg-error">
                Failed to load jobs.
              </Text>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <Select.Trigger className="max-w-md">
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
        </Tabs.Content>

        <Tabs.Content value="batches">
          <BatchesHistory />
        </Tabs.Content>

        <Tabs.Content value="runs">
          <AllRunsHistory />
        </Tabs.Content>
      </Tabs>
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
