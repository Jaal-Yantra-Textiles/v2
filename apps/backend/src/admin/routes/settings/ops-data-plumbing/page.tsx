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
  toast,
  usePrompt,
} from "@medusajs/ui"
import { Tools } from "@medusajs/icons"
import { useMemo, useState } from "react"

import {
  useMaintenanceJobs,
  useMaintenanceRuns,
  useRunMaintenanceJob,
  type MaintenanceJobSummary,
  type MaintenanceJobResult,
} from "../../../hooks/api/ops-maintenance"

/**
 * Settings → Data Plumbing (#457 / #485).
 *
 * Operator console over the guarded maintenance-jobs registry: pick a job,
 * fill its params, PREVIEW (dry-run, no writes) then APPLY (confirmed). Shows
 * the per-entity change diff and the durable run history. The job list is
 * driven entirely by the backend, so new registry jobs appear automatically.
 */

type ParamValues = Record<string, string>

const ChangesTable = ({ result }: { result: MaintenanceJobResult }) => {
  if (!result.changes.length && !(result.errors?.length)) {
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

      {result.errors && result.errors.length > 0 && (
        <div className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus" className="text-ui-fg-error">
            {result.errors.length} error(s)
          </Text>
          <ul className="mt-1 list-disc pl-5">
            {result.errors.slice(0, 50).map((e, i) => (
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

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

const RunBadge = ({ dry_run, applied }: { dry_run: boolean; applied: boolean }) => {
  if (dry_run) return <Badge color="grey" size="2xsmall">dry-run</Badge>
  if (applied) return <Badge color="green" size="2xsmall">applied</Badge>
  return <Badge color="orange" size="2xsmall">no-op</Badge>
}

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

const RunHistory = () => {
  const { runs, isLoading } = useMaintenanceRuns({ limit: 20 })

  if (isLoading) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Loading run history…
        </Text>
      </div>
    )
  }

  if (!runs.length) {
    return (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          No applied runs yet. (Dry-runs are not persisted.)
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
              <Table.Cell className="font-mono text-xs">
                {r.actor_id}
              </Table.Cell>
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
          recorded below.
        </Text>
      </div>

      <Tabs defaultValue="run">
        <div className="px-6 pt-4">
          <Tabs.List>
            <Tabs.Trigger value="run">Run a job</Tabs.Trigger>
            <Tabs.Trigger value="history">Run history</Tabs.Trigger>
          </Tabs.List>
        </div>

        <Tabs.Content value="run">
          <div className="flex flex-col gap-y-2 px-6 py-4">
            <Label size="small" weight="plus">
              Job
            </Label>
            {isLoading ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading jobs…
              </Text>
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

        <Tabs.Content value="history">
          <RunHistory />
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
