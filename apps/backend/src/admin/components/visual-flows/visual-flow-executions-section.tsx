import { useState, useEffect } from "react"
import { Container, Heading, Text, Badge, Button, Drawer, clx, toast } from "@medusajs/ui"
import { ArrowPath, ChevronRight, CheckCircleSolid, XCircleSolid, Clock, ArrowUturnLeft } from "@medusajs/icons"
import { ActionMenu } from "../common/action-menu"
import {
  VisualFlow,
  useVisualFlowExecutions,
  useVisualFlowExecution,
  useExecuteVisualFlow,
} from "../../hooks/api/visual-flows"

interface VisualFlowExecutionsSectionProps {
  flow: VisualFlow
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const getStatusBadgeColor = (status: string): "green" | "red" | "blue" | "orange" | "grey" => {
  switch (status) {
    case "completed":
    case "success":
      return "green"
    case "failed":
    case "failure":
      return "red"
    case "running":
      return "blue"
    case "pending":
      return "orange"
    default:
      return "grey"
  }
}

const formatDuration = (start: string | null, end: string | null): string => {
  if (!start) return "-"
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const formatMs = (ms: number | null): string => {
  if (ms === null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Shows "Today 14:32", "Yesterday 09:01", or "Mar 5 14:32" */
const formatTimestamp = (iso: string | null): string => {
  if (!iso) return "-"
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()

  if (isToday) return `Today ${time}`
  if (isYesterday) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
}

const formatTriggeredBy = (triggeredBy: string | null, metadata?: Record<string, any>): string => {
  if (metadata?.replayed_from) return "Replay"
  if (!triggeredBy) return "Manual"
  if (triggeredBy === "manual") return "Manual"
  if (triggeredBy === "webhook") return "Webhook"
  if (triggeredBy === "schedule") return "Schedule"
  // user_01XXXX → show "Admin"
  if (triggeredBy.startsWith("user_")) return "Admin"
  return triggeredBy.slice(0, 10)
}

const LogStatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "success":
      return <CheckCircleSolid className="text-ui-fg-interactive w-4 h-4 flex-shrink-0" />
    case "failure":
      return <XCircleSolid className="text-ui-fg-error w-4 h-4 flex-shrink-0" />
    case "running":
      return <Clock className="text-ui-fg-warning w-4 h-4 flex-shrink-0 animate-pulse" />
    default:
      return <Clock className="text-ui-fg-muted w-4 h-4 flex-shrink-0" />
  }
}

// ─── Execution Detail Drawer ──────────────────────────────────────────────────

const ExecutionDetailDrawer = ({
  flowId,
  executionId,
  open,
  onClose,
  onReplay,
  isReplaying,
}: {
  flowId: string
  executionId: string | null
  open: boolean
  onClose: () => void
  onReplay: (executionId: string) => void
  isReplaying: boolean
}) => {
  const { data: execution, isLoading } = useVisualFlowExecution(flowId, executionId || "")
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  // Reset expanded state whenever a different execution is selected
  useEffect(() => {
    setExpandedLogs(new Set())
  }, [executionId])

  const toggleLog = (logId: string) =>
    setExpandedLogs((prev) => {
      const next = new Set(prev)
      next.has(logId) ? next.delete(logId) : next.add(logId)
      return next
    })

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <div className="flex items-center justify-between w-full pr-4">
            <Drawer.Title>Execution Details</Drawer.Title>
            {executionId && execution && execution.status !== "running" && execution.status !== "pending" && (
              <ActionMenu
                groups={[
                  {
                    actions: [
                      {
                        label: isReplaying ? "Replaying…" : "Replay this execution",
                        icon: <ArrowUturnLeft />,
                        onClick: () => onReplay(executionId),
                        disabled: isReplaying,
                      },
                    ],
                  },
                ]}
              />
            )}
          </div>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Text className="text-ui-fg-subtle">Loading execution details…</Text>
            </div>
          ) : !execution ? (
            <div className="flex items-center justify-center py-8">
              <Text className="text-ui-fg-subtle">Execution not found</Text>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-ui-bg-subtle rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Badge color={getStatusBadgeColor(execution.status)} size="small">
                    {execution.status.toUpperCase()}
                  </Badge>
                  <Text size="xsmall" className="text-ui-fg-muted font-mono">
                    {execution.id.slice(0, 14)}…
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Started</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {formatTimestamp(execution.started_at)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Duration</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {formatDuration(execution.started_at, execution.completed_at)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Triggered By</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {formatTriggeredBy(execution.triggered_by, execution.metadata)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Steps</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {execution.logs?.length ?? 0}
                    </Text>
                  </div>
                </div>
                {execution.metadata?.replayed_from && (
                  <div className="mt-2 flex items-center gap-1">
                    <ArrowUturnLeft className="w-3 h-3 text-ui-fg-muted" />
                    <Text size="xsmall" className="text-ui-fg-muted font-mono">
                      Replayed from {String(execution.metadata.replayed_from).slice(0, 14)}…
                    </Text>
                  </div>
                )}
                {execution.error && (
                  <div className="mt-2 p-2 bg-ui-bg-base rounded border border-ui-border-error">
                    <Text size="xsmall" className="text-ui-fg-error font-mono break-all">
                      {execution.error.slice(0, 200)}
                      {execution.error.length > 200 ? "…" : ""}
                    </Text>
                  </div>
                )}
              </div>

              {/* Execution Steps */}
              <div>
                <Text weight="plus" size="small" className="mb-2 block">
                  Execution Steps
                </Text>
                <div className="space-y-1">
                  {execution.logs && execution.logs.length > 0 ? (
                    execution.logs.map((log, index) => {
                      const displayName = log.operation_key
                        .replace(/_\d+$/, "")
                        .replace(/_/g, " ")
                      const isExpanded = expandedLogs.has(log.id)

                      return (
                        <div
                          key={log.id}
                          className="border border-ui-border-base rounded overflow-hidden"
                        >
                          <button
                            onClick={() => toggleLog(log.id)}
                            className={clx(
                              "w-full flex flex-col px-3 py-2",
                              "hover:bg-ui-bg-subtle-hover transition-colors text-left"
                            )}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-ui-fg-muted text-xs w-4 flex-shrink-0">
                                  {index + 1}
                                </span>
                                <LogStatusIcon status={log.status} />
                                <Text
                                  size="small"
                                  className="font-medium text-ui-fg-base truncate capitalize"
                                >
                                  {displayName}
                                </Text>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Text size="xsmall" className="text-ui-fg-muted font-mono">
                                  {formatMs(log.duration_ms)}
                                </Text>
                                <ChevronRight
                                  className={clx(
                                    "w-3 h-3 text-ui-fg-muted transition-transform",
                                    isExpanded && "rotate-90"
                                  )}
                                />
                              </div>
                            </div>
                            {log.error && !isExpanded && (
                              <Text size="xsmall" className="text-ui-fg-error mt-1 ml-6 truncate">
                                {log.error.slice(0, 80)}
                                {log.error.length > 80 ? "…" : ""}
                              </Text>
                            )}
                          </button>

                          {isExpanded && (
                            <div className="border-t border-ui-border-base p-2 bg-ui-bg-subtle space-y-2">
                              {log.input_data && Object.keys(log.input_data).length > 0 && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-muted mb-1">
                                    Input
                                  </Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono max-h-32 overflow-y-auto">
                                    {JSON.stringify(log.input_data, null, 2).slice(0, 500)}
                                    {JSON.stringify(log.input_data, null, 2).length > 500
                                      ? "\n…"
                                      : ""}
                                  </pre>
                                </div>
                              )}
                              {log.output_data && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-muted mb-1">
                                    Output
                                  </Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono max-h-32 overflow-y-auto">
                                    {JSON.stringify(log.output_data, null, 2).slice(0, 500)}
                                    {JSON.stringify(log.output_data, null, 2).length > 500
                                      ? "\n…"
                                      : ""}
                                  </pre>
                                </div>
                              )}
                              {log.error && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-error mb-1">
                                    Error
                                  </Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono text-ui-fg-error max-h-24 overflow-y-auto">
                                    {log.error.slice(0, 300)}
                                    {log.error.length > 300 ? "…" : ""}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <Text size="small" className="text-ui-fg-muted text-center py-4">
                      No logs available
                    </Text>
                  )}
                </div>
              </div>

              {/* Trigger Data */}
              {execution.trigger_data && Object.keys(execution.trigger_data).length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-ui-fg-base flex items-center gap-2 select-none">
                    <ChevronRight className="w-3 h-3 text-ui-fg-muted group-open:rotate-90 transition-transform" />
                    Trigger Data
                  </summary>
                  <pre className="text-xs bg-ui-bg-subtle p-2 rounded overflow-x-auto font-mono mt-2 max-h-40 overflow-y-auto">
                    {JSON.stringify(execution.trigger_data, null, 2).slice(0, 1000)}
                    {JSON.stringify(execution.trigger_data, null, 2).length > 1000 ? "\n…" : ""}
                  </pre>
                </details>
              )}
            </div>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}

// ─── Main Section ─────────────────────────────────────────────────────────────

export const VisualFlowExecutionsSection = ({ flow }: VisualFlowExecutionsSectionProps) => {
  const [limit, setLimit] = useState(10)
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  const { data, isLoading, refetch, isFetching } = useVisualFlowExecutions(flow.id, { limit })
  const executions = data?.executions ?? []
  const totalCount = data?.count ?? 0

  const executeMutation = useExecuteVisualFlow(flow.id)
  const isReplaying = executeMutation.isPending

  const handleReplay = async (executionId: string) => {
    try {
      await executeMutation.mutateAsync({ replay_execution_id: executionId })
      toast.success("Replayed", { description: "Execution started from previous trigger data" })
      setSelectedExecutionId(null)
    } catch {
      toast.error("Replay failed")
    }
  }

  // Auto-open the latest execution after a replay/execute
  useEffect(() => {
    if (!executeMutation.isSuccess) return
    const latestId = executions[0]?.id
    if (latestId) setSelectedExecutionId(latestId)
  }, [executeMutation.isSuccess, executions])

  const lastExecution = executions[0] ?? null
  const hasActiveExecution = executions.some(
    (e) => e.status === "running" || e.status === "pending"
  )

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Recent Executions</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {hasActiveExecution ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Running…
                </span>
              ) : (
                "Click to view logs"
              )}
            </Text>
          </div>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Refresh",
                    icon: <ArrowPath className={isFetching ? "animate-spin" : ""} />,
                    onClick: () => refetch(),
                    disabled: isFetching,
                  },
                  ...(lastExecution &&
                  lastExecution.status !== "running" &&
                  lastExecution.status !== "pending"
                    ? [
                        {
                          label: isReplaying ? "Replaying…" : "Replay Last",
                          icon: <ArrowUturnLeft />,
                          onClick: () => handleReplay(lastExecution.id),
                          disabled: isReplaying || hasActiveExecution,
                          disabledTooltip: hasActiveExecution
                            ? "Wait for the current execution to finish"
                            : undefined,
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
        </div>

        <div className="px-0">
          {isLoading ? (
            <div className="text-center py-8">
              <Text className="text-ui-fg-subtle">Loading…</Text>
            </div>
          ) : executions.length === 0 ? (
            <div className="text-center py-8">
              <Text className="text-ui-fg-subtle">No executions yet</Text>
              <Text size="small" className="text-ui-fg-muted">
                Execute the flow to see results here
              </Text>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-ui-border-base">
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-28">
                      Status
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase">
                      Started
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-20">
                      Duration
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-24">
                      By
                    </th>
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border-base">
                  {executions.map((execution) => {
                    const isActive =
                      execution.status === "running" || execution.status === "pending"
                    return (
                      <tr
                        key={execution.id}
                        onClick={() => setSelectedExecutionId(execution.id)}
                        className={clx(
                          "cursor-pointer transition-colors",
                          selectedExecutionId === execution.id
                            ? "bg-ui-bg-subtle"
                            : "hover:bg-ui-bg-subtle-hover"
                        )}
                      >
                        <td className="px-4 py-3">
                          <Badge
                            color={getStatusBadgeColor(execution.status)}
                            size="small"
                            className={clx(isActive && "animate-pulse")}
                          >
                            {execution.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Text size="small" className="text-ui-fg-base whitespace-nowrap">
                            {formatTimestamp(execution.started_at ?? execution.created_at)}
                          </Text>
                        </td>
                        <td className="px-4 py-3">
                          <Text size="small" className="text-ui-fg-subtle font-mono">
                            {isActive
                              ? formatDuration(execution.started_at ?? execution.created_at, null)
                              : formatDuration(
                                  execution.started_at ?? execution.created_at,
                                  execution.completed_at
                                )}
                          </Text>
                        </td>
                        <td className="px-4 py-3">
                          <Text size="small" className="text-ui-fg-subtle">
                            {formatTriggeredBy(execution.triggered_by, execution.metadata)}
                          </Text>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-ui-fg-muted inline-block" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {executions.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-ui-border-base">
                  <Text size="small" className="text-ui-fg-muted">
                    Showing {executions.length} of {totalCount}
                  </Text>
                  {executions.length < totalCount && (
                    <Button
                      variant="transparent"
                      size="small"
                      onClick={() => setLimit((prev) => prev + 10)}
                    >
                      Load More
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Container>

      <ExecutionDetailDrawer
        flowId={flow.id}
        executionId={selectedExecutionId}
        open={!!selectedExecutionId}
        onClose={() => setSelectedExecutionId(null)}
        onReplay={handleReplay}
        isReplaying={isReplaying}
      />
    </>
  )
}
