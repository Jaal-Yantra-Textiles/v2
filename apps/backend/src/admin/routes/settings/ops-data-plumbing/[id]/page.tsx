import { Container, Heading, Text, Badge, Skeleton } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import {
  useMaintenanceRun,
  useMaintenanceBatch,
} from "../../../../hooks/api/ops-maintenance"
import { ChangesTable, RunBadge, BatchDetailView, formatValue } from "../components"

/**
 * Settings → Data Plumbing → run detail (#508). Deep-linkable detail for one
 * persisted `ops_maintenance_run`: its metadata + the per-entity change diff.
 * When the run executed inside a batch, the batch rollup and ALL its sibling
 * jobs render below with the grouped/card ↔ table view toggle.
 */
const OpsDataPlumbingRunDetailPage = () => {
  const { id } = useParams()
  const { run, isLoading, isError } = useMaintenanceRun(id)

  // Batch context — only fetched when this run belongs to a batch.
  const { batch, jobs } = useMaintenanceBatch(run?.batch_id ?? undefined)

  if (isLoading) {
    return (
      <Container className="flex flex-col gap-y-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </Container>
    )
  }

  if (isError || !run) {
    return (
      <Container className="flex flex-col gap-y-4 p-6">
        <Text size="small" className="text-ui-fg-error">
          Run not found.
        </Text>
      </Container>
    )
  }

  const paramEntries = Object.entries(run.params ?? {})

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="font-mono">{run.job_id}</Heading>
          <RunBadge dry_run={run.dry_run} applied={run.applied} />
          {run.batch_id && (
            <Badge color="blue" size="2xsmall">
              batch · #{(run.job_index ?? 0) + 1}
            </Badge>
          )}
        </div>
        <Text size="small" weight="plus">
          {run.summary}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {new Date(run.created_at).toLocaleString()} · {run.actor_id} ·{" "}
          {run.change_count} change(s)
          {run.error_count > 0 ? ` · ${run.error_count} error(s)` : ""}
        </Text>

        {paramEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {paramEntries.map(([k, v]) => (
              <Badge key={k} size="2xsmall" className="font-mono">
                {k}: {formatValue(v)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-4">
        <Text size="small" weight="plus" className="mb-2">
          Changes
        </Text>
        <ChangesTable result={run} />
      </div>

      {run.batch_id && (
        <div className="px-6 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Text size="small" weight="plus">
              Batch: {batch?.name ?? run.batch_id}
            </Text>
            {batch && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                {batch.job_count} job(s) · {batch.applied_count} applied ·{" "}
                {batch.failed_count} failed · {batch.change_count} change(s)
              </Text>
            )}
          </div>
          <BatchDetailView jobs={jobs} />
        </div>
      )}
    </Container>
  )
}

export default OpsDataPlumbingRunDetailPage

export const handle = {
  breadcrumb: () => "Run detail",
}
