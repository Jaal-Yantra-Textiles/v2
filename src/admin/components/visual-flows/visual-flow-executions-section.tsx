import { useState } from "react"
import { Container, Heading, Text, Badge, Button, Drawer, clx } from "@medusajs/ui"
import { ArrowPath, ChevronRight, CheckCircleSolid, XCircleSolid, Clock } from "@medusajs/icons"
import { 
  VisualFlow, 
  useVisualFlowExecutions, 
  useVisualFlowExecution 
} from "../../hooks/api/visual-flows"

interface VisualFlowExecutionsSectionProps {
  flow: VisualFlow
}

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
    case "cancelled":
    case "skipped":
      return "grey"
    default:
      return "grey"
  }
}

const formatDuration = (start: string | null, end: string | null): string => {
  if (!start) return "-"
  const startTime = new Date(start).getTime()
  const endTime = end ? new Date(end).getTime() : Date.now()
  const duration = endTime - startTime
  
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60000).toFixed(1)}m`
}

const formatMs = (ms: number | null): string => {
  if (ms === null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const LogStatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "success":
      return <CheckCircleSolid className="text-ui-fg-interactive w-4 h-4" />
    case "failure":
      return <XCircleSolid className="text-ui-fg-error w-4 h-4" />
    case "running":
      return <Clock className="text-ui-fg-warning w-4 h-4 animate-pulse" />
    default:
      return <Clock className="text-ui-fg-muted w-4 h-4" />
  }
}

// Execution Detail Drawer
const ExecutionDetailDrawer = ({ 
  flowId, 
  executionId, 
  open, 
  onClose 
}: { 
  flowId: string
  executionId: string | null
  open: boolean
  onClose: () => void 
}) => {
  const { data: execution, isLoading } = useVisualFlowExecution(
    flowId, 
    executionId || ""
  )
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  const toggleLog = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev)
      if (next.has(logId)) {
        next.delete(logId)
      } else {
        next.add(logId)
      }
      return next
    })
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title>Execution Details</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Text className="text-ui-fg-subtle">Loading execution details...</Text>
            </div>
          ) : !execution ? (
            <div className="flex items-center justify-center py-8">
              <Text className="text-ui-fg-subtle">Execution not found</Text>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary - Compact */}
              <div className="bg-ui-bg-subtle rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <Badge color={getStatusBadgeColor(execution.status)} size="small">
                    {execution.status.toUpperCase()}
                  </Badge>
                  <Text size="xsmall" className="text-ui-fg-muted font-mono">
                    {execution.id.slice(0, 12)}...
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Started</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {execution.started_at 
                        ? new Date(execution.started_at).toLocaleTimeString()
                        : "-"}
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
                    <Text size="small" className="text-ui-fg-base truncate" title={execution.triggered_by || "Manual"}>
                      {execution.triggered_by ? execution.triggered_by.slice(0, 16) + "..." : "Manual"}
                    </Text>
                  </div>
                  <div>
                    <Text size="xsmall" className="text-ui-fg-muted">Steps</Text>
                    <Text size="small" className="text-ui-fg-base">
                      {execution.logs?.length || 0}
                    </Text>
                  </div>
                </div>
                {execution.error && (
                  <div className="mt-2 p-2 bg-ui-bg-base rounded border border-ui-border-error">
                    <Text size="xsmall" className="text-ui-fg-error font-mono break-all">
                      {execution.error.slice(0, 200)}{execution.error.length > 200 ? "..." : ""}
                    </Text>
                  </div>
                )}
              </div>

              {/* Execution Logs */}
              <div>
                <Text weight="plus" size="small" className="mb-2 block">Execution Steps</Text>
                <div className="space-y-1">
                  {execution.logs && execution.logs.length > 0 ? (
                    execution.logs.map((log, index) => {
                      // Clean up operation key for display
                      const displayName = log.operation_key
                        .replace(/_\d+$/, "") // Remove trailing numbers
                        .replace(/_/g, " ") // Replace underscores with spaces
                      
                      return (
                        <div 
                          key={log.id}
                          className="border border-ui-border-base rounded overflow-hidden"
                        >
                          <button
                            onClick={() => toggleLog(log.id)}
                            className={clx(
                              "w-full flex flex-col px-3 py-2",
                              "hover:bg-ui-bg-subtle-hover transition-colors",
                              "text-left"
                            )}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-ui-fg-muted text-xs w-4">{index + 1}</span>
                                <LogStatusIcon status={log.status} />
                                <Text size="small" className="font-medium text-ui-fg-base truncate capitalize">
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
                                    expandedLogs.has(log.id) && "rotate-90"
                                  )} 
                                />
                              </div>
                            </div>
                            {/* Show error preview in collapsed state */}
                            {log.error && !expandedLogs.has(log.id) && (
                              <Text size="xsmall" className="text-ui-fg-error mt-1 ml-6 truncate">
                                {log.error.slice(0, 80)}{log.error.length > 80 ? "..." : ""}
                              </Text>
                            )}
                          </button>
                          
                          {expandedLogs.has(log.id) && (
                            <div className="border-t border-ui-border-base p-2 bg-ui-bg-subtle space-y-2">
                              {log.input_data && Object.keys(log.input_data).length > 0 && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-muted mb-1">Input</Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono max-h-32 overflow-y-auto">
                                    {JSON.stringify(log.input_data, null, 2).slice(0, 500)}
                                    {JSON.stringify(log.input_data, null, 2).length > 500 ? "\n..." : ""}
                                  </pre>
                                </div>
                              )}
                              {log.output_data && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-muted mb-1">Output</Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono max-h-32 overflow-y-auto">
                                    {JSON.stringify(log.output_data, null, 2).slice(0, 500)}
                                    {JSON.stringify(log.output_data, null, 2).length > 500 ? "\n..." : ""}
                                  </pre>
                                </div>
                              )}
                              {log.error && (
                                <div>
                                  <Text size="xsmall" className="text-ui-fg-error mb-1">Error</Text>
                                  <pre className="text-xs bg-ui-bg-base p-2 rounded overflow-x-auto font-mono text-ui-fg-error max-h-24 overflow-y-auto">
                                    {log.error.slice(0, 300)}{log.error.length > 300 ? "..." : ""}
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

              {/* Trigger Data - Collapsed by default */}
              {execution.trigger_data && Object.keys(execution.trigger_data).length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-ui-fg-base flex items-center gap-2">
                    <ChevronRight className="w-3 h-3 text-ui-fg-muted group-open:rotate-90 transition-transform" />
                    Trigger Data
                  </summary>
                  <pre className="text-xs bg-ui-bg-subtle p-2 rounded overflow-x-auto font-mono mt-2 max-h-40 overflow-y-auto">
                    {JSON.stringify(execution.trigger_data, null, 2).slice(0, 1000)}
                    {JSON.stringify(execution.trigger_data, null, 2).length > 1000 ? "\n..." : ""}
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

export const VisualFlowExecutionsSection = ({ flow }: VisualFlowExecutionsSectionProps) => {
  const { data, isLoading, refetch } = useVisualFlowExecutions(flow.id, { limit: 5 })
  const executions = data?.executions || []
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Recent Executions</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Click to view logs
            </Text>
          </div>
          <Button 
            variant="transparent" 
            size="small" 
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <ArrowPath className={isLoading ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="px-0">
          {isLoading ? (
            <div className="text-center py-8">
              <Text className="text-ui-fg-subtle">Loading...</Text>
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
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-24">
                      Status
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-20">
                      Started
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase w-20">
                      Duration
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-ui-fg-muted uppercase">
                      Triggered By
                    </th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border-base">
                  {executions.map((execution) => (
                    <tr 
                      key={execution.id}
                      onClick={() => setSelectedExecutionId(execution.id)}
                      className="hover:bg-ui-bg-subtle-hover cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Badge color={getStatusBadgeColor(execution.status)} size="small">
                          {execution.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Text size="small" className="text-ui-fg-base">
                          {execution.started_at 
                            ? new Date(execution.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : "-"}
                        </Text>
                      </td>
                      <td className="px-4 py-3">
                        <Text size="small" className="text-ui-fg-subtle font-mono">
                          {formatDuration(execution.started_at, execution.completed_at)}
                        </Text>
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <Text size="small" className="text-ui-fg-subtle truncate block">
                          {execution.triggered_by 
                            ? (execution.triggered_by.startsWith("user_") 
                                ? execution.triggered_by.slice(5, 13) + "..." 
                                : execution.triggered_by.slice(0, 10) + "...")
                            : "Manual"}
                        </Text>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <ChevronRight className="w-4 h-4 text-ui-fg-muted inline-block" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Container>

      <ExecutionDetailDrawer
        flowId={flow.id}
        executionId={selectedExecutionId}
        open={!!selectedExecutionId}
        onClose={() => setSelectedExecutionId(null)}
      />
    </>
  )
}
