import { Badge, Button, Table, Text } from "@medusajs/ui"
import { useState } from "react"

import type {
  MaintenanceChange,
  MaintenanceJobResult,
  MaintenanceRun,
} from "../../../hooks/api/ops-maintenance"

/**
 * Shared presentational helpers for the Settings → Data Plumbing console
 * (#457 / #485 / #508). Extracted from `page.tsx` so the single-job runner,
 * the batch-history table, and the batch-detail card/table views all render the
 * same change diff + run badges without duplicating logic.
 */

export const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export const RunBadge = ({
  dry_run,
  applied,
}: {
  dry_run: boolean
  applied: boolean
}) => {
  if (dry_run)
    return (
      <Badge color="grey" size="2xsmall">
        dry-run
      </Badge>
    )
  if (applied)
    return (
      <Badge color="green" size="2xsmall">
        applied
      </Badge>
    )
  return (
    <Badge color="orange" size="2xsmall">
      no-op
    </Badge>
  )
}

type ChangeLike = {
  changes: MaintenanceChange[]
  errors?: Array<{ id: string; message: string }> | null
}

/**
 * Per-entity change diff + error list. Accepts either a fresh job result or a
 * persisted run row (both expose `changes`/`errors`). Caps rows so a huge diff
 * can't blow up the DOM, and discloses the cap rather than silently truncating.
 */
export const ChangesTable = ({ result }: { result: ChangeLike }) => {
  const errors = result.errors ?? []

  if (!result.changes.length && !errors.length) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No changes — data already consistent.
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      {result.changes.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Entity</Table.HeaderCell>
              <Table.HeaderCell>ID</Table.HeaderCell>
              <Table.HeaderCell>Field</Table.HeaderCell>
              <Table.HeaderCell>Before</Table.HeaderCell>
              <Table.HeaderCell>After</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {result.changes.slice(0, 200).map((c, i) => (
              <Table.Row key={`${c.entity}-${c.id}-${c.field ?? ""}-${i}`}>
                <Table.Cell>{c.entity}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{c.id}</Table.Cell>
                <Table.Cell>{c.field ?? "—"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">
                  {formatValue(c.before)}
                </Table.Cell>
                <Table.Cell className="font-mono text-xs">
                  {formatValue(c.after)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {result.changes.length > 200 && (
        <Text size="small" className="text-ui-fg-subtle">
          Showing first 200 of {result.changes.length} changes.
        </Text>
      )}

      {errors.length > 0 && (
        <div className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus" className="text-ui-fg-error">
            {errors.length} error(s)
          </Text>
          <ul className="mt-1 list-disc pl-5">
            {errors.slice(0, 50).map((e, i) => (
              <li key={`${e.id}-${i}`}>
                <Text size="small" className="text-ui-fg-subtle">
                  <span className="font-mono">{e.id}</span>: {e.message}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One expandable card per child run within a batch (grouped/card view). */
const BatchJobCard = ({ run }: { run: MaintenanceRun }) => {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col gap-y-2 rounded-md border border-ui-border-base p-4">
      <div className="flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <Text size="small" className="text-ui-fg-muted">
            #{(run.job_index ?? 0) + 1}
          </Text>
          <Text size="small" weight="plus" className="font-mono">
            {run.job_id}
          </Text>
          <RunBadge dry_run={run.dry_run} applied={run.applied} />
        </div>
        <div className="flex items-center gap-x-3">
          <Text size="small" className="text-ui-fg-subtle">
            {run.change_count} change(s)
            {run.error_count > 0 ? ` · ${run.error_count} error(s)` : ""}
          </Text>
          <Button
            variant="transparent"
            size="small"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Details"}
          </Button>
        </div>
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {run.summary}
      </Text>
      {open && (
        <div className="mt-2">
          <ChangesTable result={run} />
        </div>
      )}
    </div>
  )
}

/** Flat table of every change across all child runs (table view). */
const BatchFlatChanges = ({ jobs }: { jobs: MaintenanceRun[] }) => {
  const rows = jobs.flatMap((run) =>
    run.changes.map((c) => ({ job_id: run.job_id, change: c }))
  )
  const errorRows = jobs.flatMap((run) =>
    (run.errors ?? []).map((e) => ({ job_id: run.job_id, error: e }))
  )

  if (!rows.length && !errorRows.length) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No changes — data already consistent.
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      {rows.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Job</Table.HeaderCell>
              <Table.HeaderCell>Entity</Table.HeaderCell>
              <Table.HeaderCell>ID</Table.HeaderCell>
              <Table.HeaderCell>Field</Table.HeaderCell>
              <Table.HeaderCell>Before</Table.HeaderCell>
              <Table.HeaderCell>After</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.slice(0, 300).map((r, i) => (
              <Table.Row key={`${r.job_id}-${r.change.id}-${i}`}>
                <Table.Cell className="font-mono text-xs">{r.job_id}</Table.Cell>
                <Table.Cell>{r.change.entity}</Table.Cell>
                <Table.Cell className="font-mono text-xs">
                  {r.change.id}
                </Table.Cell>
                <Table.Cell>{r.change.field ?? "—"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">
                  {formatValue(r.change.before)}
                </Table.Cell>
                <Table.Cell className="font-mono text-xs">
                  {formatValue(r.change.after)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {rows.length > 300 && (
        <Text size="small" className="text-ui-fg-subtle">
          Showing first 300 of {rows.length} changes.
        </Text>
      )}

      {errorRows.length > 0 && (
        <div className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus" className="text-ui-fg-error">
            {errorRows.length} error(s)
          </Text>
          <ul className="mt-1 list-disc pl-5">
            {errorRows.slice(0, 50).map((r, i) => (
              <li key={`${r.job_id}-${r.error.id}-${i}`}>
                <Text size="small" className="text-ui-fg-subtle">
                  <span className="font-mono">{r.job_id}</span> ·{" "}
                  <span className="font-mono">{r.error.id}</span>:{" "}
                  {r.error.message}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Batch-detail body with a card ↔ table view toggle (#508). Card view = one
 * expandable card per child job; table view = every change flattened across all
 * jobs. Rendered inside the history drawer.
 */
export const BatchDetailView = ({ jobs }: { jobs: MaintenanceRun[] }) => {
  const [view, setView] = useState<"cards" | "table">("cards")

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center gap-x-2">
        <Button
          variant={view === "cards" ? "primary" : "secondary"}
          size="small"
          onClick={() => setView("cards")}
        >
          Cards
        </Button>
        <Button
          variant={view === "table" ? "primary" : "secondary"}
          size="small"
          onClick={() => setView("table")}
        >
          Table
        </Button>
      </div>

      {!jobs.length ? (
        <Text size="small" className="text-ui-fg-subtle">
          This batch has no child runs.
        </Text>
      ) : view === "cards" ? (
        <div className="flex flex-col gap-y-3">
          {jobs.map((run) => (
            <BatchJobCard key={run.id} run={run} />
          ))}
        </div>
      ) : (
        <BatchFlatChanges jobs={jobs} />
      )}
    </div>
  )
}
