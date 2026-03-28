import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Select,
  StatusBadge,
  Text,
  Textarea,
  Tooltip,
  clx,
  toast,
  usePrompt,
} from "@medusajs/ui"
import {
  InformationCircleSolid,
  ExclamationCircle,
} from "@medusajs/icons"
import { useState } from "react"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  usePartnerProductionRuns,
  useAcceptPartnerProductionRun,
  useStartPartnerProductionRun,
  useFinishPartnerProductionRun,
  useCompletePartnerProductionRun,
} from "../../../../hooks/api/partner-production-runs"
import {
  usePartnerConsumptionLogs,
} from "../../../../hooks/api/partner-consumption-logs"
import {
  useAcceptPartnerAssignedTask,
  useFinishPartnerAssignedTask,
  useCompletePartnerAssignedTaskSubtask,
} from "../../../../hooks/api/partner-assigned-tasks"
import { getStatusBadgeColor } from "../../../../lib/status-badge"
import { extractErrorMessage } from "../../../../lib/extract-error-message"

type DesignProductionSectionProps = {
  design: PartnerDesign
}

export const DesignProductionSection = ({ design }: DesignProductionSectionProps) => {
  const { production_runs = [], isPending } = usePartnerProductionRuns({
    design_id: design.id,
    limit: 50,
  })

  if (isPending) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Production</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (!production_runs.length) {
    return null
  }

  return (
    <>
      {production_runs.map((run: any) => (
        <ProductionRunCard key={String(run.id)} run={run} design={design} />
      ))}
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatFullDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function durationBetween(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return ""
  const diffMs = new Date(to).getTime() - new Date(from).getTime()
  if (diffMs < 0) return ""
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

function getTargetDateStatus(targetDate: string | null | undefined): {
  label: string
  color: "red" | "orange" | "grey"
} | null {
  if (!targetDate) return null
  const target = new Date(targetDate)
  const now = new Date()
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const formatted = target.toLocaleDateString("en-US", { month: "short", day: "numeric" })

  if (diffDays < 0) return { label: `Overdue (${formatted})`, color: "red" }
  if (diffDays <= 2) return { label: `Due ${formatted}`, color: "orange" }
  return { label: `Due ${formatted}`, color: "grey" }
}

/** Map run status to StatusBadge color */
const runStatusColor = (status: string): "green" | "orange" | "red" | "blue" | "grey" => {
  switch (status) {
    case "completed": return "green"
    case "in_progress": return "orange"
    case "sent_to_partner": return "blue"
    case "cancelled": return "red"
    default: return "grey"
  }
}

/** Returns contextual guidance for the current stage */
function getStageGuidance(
  run: any,
  isSample: boolean
): { title: string; description: string } | null {
  const status = String(run.status || "")
  if (status === "cancelled" || status === "completed") return null

  if (status === "sent_to_partner") {
    return {
      title: "Accept this run to get started",
      description: "Review the details and confirm you'll handle this work.",
    }
  }
  if (status === "in_progress" && !run.started_at) {
    return {
      title: "Mark as started when you begin working",
      description: "This helps track production timelines accurately.",
    }
  }
  if (status === "in_progress" && run.started_at && !run.finished_at) {
    if (isSample) {
      return {
        title: "Log materials as you work",
        description:
          "Track all materials used — this data will be used to calculate the design's cost estimate. Mark finished when done.",
      }
    }
    return {
      title: "Mark finished when work is done",
      description: "Once finished, the admin team will review your work before final completion.",
    }
  }
  if (status === "in_progress" && run.finished_at) {
    if (isSample) {
      return {
        title: "Complete with cost details",
        description:
          "Log final material usage and your cost estimate. This is critical for pricing — be thorough.",
      }
    }
    return {
      title: "Complete the run",
      description: "Log any remaining material usage and your production cost to finalize.",
    }
  }
  return null
}

// ── Progress Steps ──────────────────────────────────────────────────

const STEPS = [
  { key: "received", label: "Received" },
  { key: "accepted", label: "Accepted" },
  { key: "started", label: "Started" },
  { key: "finished", label: "Finished" },
  { key: "completed", label: "Completed" },
]

const ProgressStepper = ({ run }: { run: any }) => {
  const status = String(run.status || "")
  if (status === "cancelled") return null

  let currentIdx = 0
  if (run.completed_at) currentIdx = 4
  else if (run.finished_at) currentIdx = 3
  else if (run.started_at) currentIdx = 2
  else if (run.accepted_at) currentIdx = 1

  return (
    <div className="flex items-center gap-1 px-6 py-3">
      {STEPS.map((step, idx) => {
        const isDone = idx <= currentIdx
        const isCurrent = idx === currentIdx
        return (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={clx("h-1.5 w-full rounded-full", {
                  "bg-ui-fg-interactive": isDone,
                  "bg-ui-border-base": !isDone,
                })}
              />
              <Text
                size="xsmall"
                className={clx("mt-1", {
                  "text-ui-fg-base font-medium": isCurrent,
                  "text-ui-fg-subtle": isDone && !isCurrent,
                  "text-ui-fg-muted": !isDone,
                })}
              >
                {step.label}
              </Text>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Timeline Item (dot + line pattern) ──────────────────────────────

const TimelineItem = ({
  label,
  dateStr,
  duration,
  isLast,
  dotColor = "bg-ui-tag-neutral-icon",
}: {
  label: string
  dateStr: string
  duration?: string
  isLast?: boolean
  dotColor?: string
}) => (
  <div className="grid grid-cols-[20px_1fr] items-start gap-2">
    <div className="flex size-full flex-col items-center gap-y-0.5">
      <div className="flex size-5 items-center justify-center">
        <div className="bg-ui-bg-base shadow-borders-base flex size-2.5 items-center justify-center rounded-full">
          <div className={clx("size-1.5 rounded-full", dotColor)} />
        </div>
      </div>
      {!isLast && <div className="bg-ui-border-base w-px flex-1" />}
    </div>
    <div className={clx({ "pb-3": !isLast })}>
      <div className="flex items-center justify-between gap-2">
        <Text size="small" leading="compact" weight="plus">
          {label}
        </Text>
        <Tooltip content={formatFullDate(dateStr)}>
          <Text size="small" leading="compact" className="text-ui-fg-subtle text-right cursor-default">
            {formatDateTime(dateStr)}
          </Text>
        </Tooltip>
      </div>
      {duration && (
        <Text size="xsmall" className="text-ui-fg-muted">{duration}</Text>
      )}
    </div>
  </div>
)

// ── Info Banner (Medusa pattern) ────────────────────────────────────

const InfoBanner = ({
  title,
  description,
  variant = "info",
}: {
  title: string
  description: string
  variant?: "info" | "warning"
}) => (
  <div className="flex items-start gap-x-3 rounded-xl border border-ui-border-base bg-ui-bg-subtle px-4 py-3 mx-6 my-3">
    {variant === "warning" ? (
      <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-orange-icon" />
    ) : (
      <InformationCircleSolid className="mt-0.5 shrink-0 text-ui-fg-interactive" />
    )}
    <div className="flex flex-col gap-y-0.5">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        {title}
      </Text>
      <Text size="xsmall" className="text-ui-fg-subtle">
        {description}
      </Text>
    </div>
  </div>
)

// ── Production Run Card ─────────────────────────────────────────────

const ProductionRunCard = ({ run, design }: { run: any; design: PartnerDesign }) => {
  const runId = String(run.id)
  const status = String(run.status || "")
  const tasks = run.tasks || []
  const isSample = run.run_type === "sample"
  const prompt = usePrompt()
  const [showFinishForm, setShowFinishForm] = useState(false)
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [finishNotes, setFinishNotes] = useState("")

  // Fetch consumption logs for material progress
  const { logs: consumptionLogs = [], count: consumptionCount = 0 } =
    usePartnerConsumptionLogs(design.id)

  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run accepted"),
  })
  const start = useStartPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run started"),
  })
  const finish = useFinishPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run finished — admin will review"),
  })
  const complete = useCompletePartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run completed")
      setShowCompleteForm(false)
    },
  })

  const isCancelled = status === "cancelled"
  const isCompleted = status === "completed"
  const canAccept = !isCancelled && status === "sent_to_partner"
  const canStart = !isCancelled && status === "in_progress" && !run.started_at
  const canFinish = !isCancelled && status === "in_progress" && !!run.started_at && !run.finished_at
  const canComplete = !isCancelled && status === "in_progress" && !!run.finished_at

  const completedTasks = tasks.filter((t: any) => String(t.status) === "completed").length
  const totalTasks = tasks.length
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )

  const targetDateInfo = getTargetDateStatus((design as any)?.target_completion_date)
  const guidance = getStageGuidance(run, isSample)

  // ── Actions ──

  const handleAccept = async () => {
    const confirmed = await prompt({
      title: "Accept Production Run",
      description: `Accept this ${isSample ? "sample" : "production"} run for "${design.name || "this design"}"? You'll be responsible for completing it.`,
      confirmText: "Accept",
      cancelText: "Cancel",
      variant: "confirmation",
    })
    if (!confirmed) return
    try {
      await accept.mutateAsync()
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleStart = async () => {
    try {
      await start.mutateAsync()
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinishClick = () => setShowFinishForm(true)

  const handleFinishConfirm = async () => {
    try {
      await finish.mutateAsync({ notes: finishNotes || undefined } as any)
      setShowFinishForm(false)
      setFinishNotes("")
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleCompleteClick = () => setShowCompleteForm(true)

  // Derive the primary action
  const primaryAction = canAccept
    ? { label: "Accept Run", onClick: handleAccept, loading: accept.isPending }
    : canStart
    ? { label: "Start Working", onClick: handleStart, loading: start.isPending }
    : canFinish
    ? { label: "Mark Finished", onClick: handleFinishClick, loading: finish.isPending }
    : canComplete
    ? { label: "Complete Run", onClick: handleCompleteClick, loading: complete.isPending }
    : null

  // ── Timeline entries ──

  const timelineEntries: Array<{
    label: string
    dateStr: string
    duration?: string
    dotColor?: string
  }> = []

  if (run.accepted_at) {
    timelineEntries.push({
      label: "Accepted",
      dateStr: run.accepted_at,
      dotColor: "bg-ui-tag-blue-icon",
    })
  }
  if (run.started_at) {
    timelineEntries.push({
      label: "Started",
      dateStr: run.started_at,
      duration: run.accepted_at ? `${durationBetween(run.accepted_at, run.started_at)} after accept` : undefined,
      dotColor: "bg-ui-tag-orange-icon",
    })
  }
  if (run.finished_at) {
    timelineEntries.push({
      label: "Finished",
      dateStr: run.finished_at,
      duration: run.started_at ? `${durationBetween(run.started_at, run.finished_at)} work time` : undefined,
      dotColor: "bg-ui-tag-orange-icon",
    })
  }
  if (run.completed_at) {
    timelineEntries.push({
      label: "Completed",
      dateStr: run.completed_at,
      duration: run.finished_at ? `${durationBetween(run.finished_at, run.completed_at)} review` : undefined,
      dotColor: "bg-ui-tag-green-icon",
    })
  }

  return (
    <Container className={clx("divide-y p-0", { "opacity-60": isCancelled })}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h2">Production</Heading>
            <Badge size="2xsmall" color={isSample ? "blue" : "grey"}>
              {isSample ? "Sample" : "Production"}
            </Badge>
            <StatusBadge color={runStatusColor(status)}>
              {status.replace(/_/g, " ")}
            </StatusBadge>
            {targetDateInfo && (
              <Badge size="2xsmall" color={targetDateInfo.color}>
                {targetDateInfo.label}
              </Badge>
            )}
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Qty: {run.quantity ?? "-"}
            {run.role ? ` · ${run.role}` : ""}
            {totalTasks > 0 ? ` · ${completedTasks}/${totalTasks} tasks` : ""}
            {consumptionCount > 0 ? ` · ${consumptionCount} material${consumptionCount !== 1 ? "s" : ""} logged` : ""}
          </Text>

          {/* Cancelled state with reason */}
          {isCancelled && (
            <div className="mt-2">
              <Text size="xsmall" className="text-ui-fg-error">
                This production run has been cancelled.
              </Text>
              {run.cancelled_reason && (
                <Text size="xsmall" className="text-ui-fg-subtle mt-0.5">
                  Reason: {run.cancelled_reason}
                </Text>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-x-2">
          {primaryAction && (
            <Button
              size="small"
              isLoading={primaryAction.loading}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>

      {/* Contextual guidance */}
      {guidance && !isCancelled && (
        <InfoBanner title={guidance.title} description={guidance.description} />
      )}

      {/* Sample run emphasis */}
      {isSample && !isCancelled && !isCompleted && run.started_at && (
        <InfoBanner
          title="Sample run — material tracking is essential"
          description="Log all materials used so the design cost can be estimated accurately."
          variant="warning"
        />
      )}

      {/* Progress stepper */}
      <ProgressStepper run={run} />

      {/* Finish confirmation form */}
      {showFinishForm && canFinish && (
        <FinishRunForm
          pendingTasks={pendingTasks}
          finishNotes={finishNotes}
          setFinishNotes={setFinishNotes}
          onConfirm={handleFinishConfirm}
          onCancel={() => { setShowFinishForm(false); setFinishNotes("") }}
          isLoading={finish.isPending}
          isSample={isSample}
          consumptionCount={consumptionCount}
        />
      )}

      {/* Complete confirmation form */}
      {showCompleteForm && canComplete && (
        <CompleteRunForm
          run={run}
          design={design}
          onComplete={async (body) => {
            try {
              const result = await complete.mutateAsync(body as any)
              // Check for partial consumption failures
              const submitted = body?.consumptions?.length || 0
              const logged = (result as any)?.consumptions_logged || 0
              if (submitted > 0 && logged < submitted) {
                toast.warning(
                  `${logged} of ${submitted} consumption entries were recorded. ${submitted - logged} failed — check inventory items.`
                )
              }
            } catch (e) {
              toast.error(extractErrorMessage(e))
            }
          }}
          onCancel={() => setShowCompleteForm(false)}
          isLoading={complete.isPending}
          isSample={isSample}
          existingConsumptionCount={consumptionCount}
        />
      )}

      {/* Yield summary (shown after completion) */}
      {isCompleted && run.produced_quantity != null && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Output
          </Text>
          <div className="flex items-center gap-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">Ordered</Text>
              <Text size="small" weight="plus">{run.quantity}</Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">Produced</Text>
              <Text size="small" weight="plus">{run.produced_quantity}</Text>
            </div>
            {(run.rejected_quantity || 0) > 0 && (
              <div>
                <Text size="xsmall" className="text-ui-fg-muted">Rejected</Text>
                <Text size="small" weight="plus" className="text-ui-fg-error">{run.rejected_quantity}</Text>
              </div>
            )}
            <div>
              <Text size="xsmall" className="text-ui-fg-muted">Yield</Text>
              <Text size="small" weight="plus">
                {run.quantity > 0 ? Math.round((run.produced_quantity / run.quantity) * 100) : 0}%
              </Text>
            </div>
          </div>
          {run.rejection_reason && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-2">
              Rejection: {run.rejection_reason.replace(/_/g, " ")}
              {run.rejection_notes ? ` — ${run.rejection_notes}` : ""}
            </Text>
          )}
        </div>
      )}

      {/* Submitted details (cost, notes) */}
      {(run.finish_notes || run.completion_notes || run.partner_cost_estimate) && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Your submitted details
          </Text>
          <div className="flex flex-col gap-y-1.5">
            {run.partner_cost_estimate != null && (
              <div className="flex items-center gap-2">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Cost ({run.cost_type === "per_unit" ? "per unit" : "total"}):
                </Text>
                <Text size="xsmall" weight="plus">
                  {run.partner_cost_estimate}
                  {run.cost_type === "per_unit" && run.produced_quantity
                    ? ` × ${run.produced_quantity} = ${Math.round(run.partner_cost_estimate * run.produced_quantity * 100) / 100}`
                    : ""
                  }
                </Text>
              </div>
            )}
            {run.finish_notes && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Finish notes:</Text>
                <Text size="xsmall" className="mt-0.5">{run.finish_notes}</Text>
              </div>
            )}
            {run.completion_notes && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle">Completion notes:</Text>
                <Text size="xsmall" className="mt-0.5">{run.completion_notes}</Text>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Material summary for completed runs */}
      {isCompleted && consumptionLogs.length > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Materials used ({consumptionLogs.length})
          </Text>
          <div className="flex flex-col gap-y-1">
            {consumptionLogs.slice(0, 5).map((log: any) => {
              const item = ((design?.inventory_items || []) as any[]).find(
                (i: any) => i.id === log.inventory_item_id
              )
              const label = item?.title || item?.sku || log.inventory_item_id
              return (
                <div key={log.id} className="flex items-center justify-between">
                  <Text size="xsmall" className="text-ui-fg-subtle">{label}</Text>
                  <Text size="xsmall">
                    {log.quantity} {log.unit_of_measure}
                    {log.unit_cost ? ` @ ${log.unit_cost}/unit` : ""}
                  </Text>
                </div>
              )
            })}
            {consumptionLogs.length > 5 && (
              <Text size="xsmall" className="text-ui-fg-muted mt-1">
                +{consumptionLogs.length - 5} more in Material Usage below
              </Text>
            )}
          </div>
        </div>
      )}

      {/* Timeline (dot + line pattern) */}
      {timelineEntries.length > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-3">
            Timeline
          </Text>
          <div className="flex flex-col">
            {timelineEntries.map((entry, idx) => (
              <TimelineItem
                key={entry.label}
                label={entry.label}
                dateStr={entry.dateStr}
                duration={entry.duration}
                isLast={idx === timelineEntries.length - 1}
                dotColor={entry.dotColor}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {totalTasks > 0 && (
        <div className="px-6 py-4">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-3">
            Tasks ({completedTasks}/{totalTasks})
          </Text>
          <div className="flex flex-col gap-y-3">
            {tasks.map((t: any) => (
              <InlineTaskCard key={String(t.id)} task={t} />
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}

// ── Finish Run Form ─────────────────────────────────────────────────

const FinishRunForm = ({
  pendingTasks,
  finishNotes,
  setFinishNotes,
  onConfirm,
  onCancel,
  isLoading,
  isSample,
  consumptionCount,
}: {
  pendingTasks: any[]
  finishNotes: string
  setFinishNotes: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  isLoading: boolean
  isSample: boolean
  consumptionCount: number
}) => {
  const [acknowledgedPending, setAcknowledgedPending] = useState(false)
  const hasPending = pendingTasks.length > 0
  const canConfirm = !hasPending || acknowledgedPending

  return (
    <div className="px-6 py-4 bg-ui-bg-subtle">
      <Heading level="h3" className="mb-2">Mark as Finished</Heading>
      <Text size="small" className="text-ui-fg-subtle mb-3">
        The design will move to Technical Review for admin to inspect.
      </Text>

      {/* Sample run warning if no materials logged */}
      {isSample && consumptionCount === 0 && (
        <div className="flex items-start gap-x-3 rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3 mb-3">
          <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-orange-icon" />
          <div className="flex flex-col gap-y-0.5">
            <Text size="small" weight="plus">No materials logged yet</Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              For sample runs, material usage data is needed for cost estimation. Consider logging materials before finishing.
            </Text>
          </div>
        </div>
      )}

      {hasPending && (
        <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3 mb-3">
          <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
            {pendingTasks.length} task(s) still pending
          </Text>
          <div className="flex flex-col gap-y-0.5 mb-3">
            {pendingTasks.map((t: any) => (
              <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
                &bull; {t.title || t.id}
              </Text>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={acknowledgedPending}
              onCheckedChange={(checked) => setAcknowledgedPending(!!checked)}
            />
            <Text size="xsmall">
              I confirm these tasks are completed or not needed
            </Text>
          </label>
        </div>
      )}

      <div className="mb-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
          Notes for reviewer (optional)
        </Text>
        <Textarea
          placeholder="Any notes about the finished work, issues encountered, etc."
          value={finishNotes}
          onChange={(e) => setFinishNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="bg-ui-bg-subtle flex items-center justify-end gap-x-2 rounded-b-xl pt-2">
        <Button variant="secondary" size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          isLoading={isLoading}
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          Confirm & Mark Finished
        </Button>
      </div>
    </div>
  )
}

// ── Complete Run Form ───────────────────────────────────────────────

const UNIT_OPTIONS = [
  { value: "Meter", label: "Meter" },
  { value: "Yard", label: "Yard" },
  { value: "Kilogram", label: "Kilogram" },
  { value: "Gram", label: "Gram" },
  { value: "Piece", label: "Piece" },
  { value: "Roll", label: "Roll" },
  { value: "Other", label: "Other" },
]

type ConsumptionEntry = {
  inventory_item_id: string
  quantity: string
  unit_cost: string
  unit_of_measure: string
  notes: string
}

const REJECTION_REASONS = [
  { value: "stitching_defect", label: "Stitching defect" },
  { value: "fabric_flaw", label: "Fabric flaw" },
  { value: "color_mismatch", label: "Color mismatch" },
  { value: "sizing_error", label: "Sizing error" },
  { value: "print_defect", label: "Print defect" },
  { value: "material_damage", label: "Material damage" },
  { value: "quality_below_standard", label: "Quality below standard" },
  { value: "other", label: "Other" },
]

const CompleteRunForm = ({
  run,
  design,
  onComplete,
  onCancel,
  isLoading,
  isSample,
  existingConsumptionCount,
}: {
  run: any
  design: PartnerDesign
  onComplete: (body: any) => Promise<void>
  onCancel: () => void
  isLoading: boolean
  isSample: boolean
  existingConsumptionCount: number
}) => {
  const inventoryItems = (design?.inventory_items || []) as Array<Record<string, any>>
  const tasks = run.tasks || []
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )
  const prompt = usePrompt()
  const runQuantity = run.quantity || 1

  // ── Step 1: Output ──
  const [producedQty, setProducedQty] = useState(String(runQuantity))
  const [rejectedQty, setRejectedQty] = useState("")
  const [rejectionReason, setRejectionReason] = useState("")
  const [rejectionNotes, setRejectionNotes] = useState("")

  // ── Step 2: Cost ──
  const [costType, setCostType] = useState<"per_unit" | "total">("total")
  const [partnerEstimate, setPartnerEstimate] = useState("")

  // ── Step 3: Additional materials ──
  const [showMaterialForm, setShowMaterialForm] = useState(false)
  const [consumptions, setConsumptions] = useState<ConsumptionEntry[]>(
    inventoryItems.map((item) => ({
      inventory_item_id: item.id,
      quantity: "",
      unit_cost: "",
      unit_of_measure: "Meter",
      notes: "",
    }))
  )

  // ── Step 4: Notes ──
  const [completionNotes, setCompletionNotes] = useState("")

  // Derived values
  const produced = parseFloat(producedQty) || 0
  const rejected = parseFloat(rejectedQty) || 0
  const yieldPct = runQuantity > 0 ? Math.round((produced / runQuantity) * 100) : 0
  const costValue = parseFloat(partnerEstimate) || 0
  const totalCost = costType === "per_unit" ? Math.round(costValue * produced * 100) / 100 : costValue
  const perUnitCost = costType === "total" && produced > 0 ? Math.round(costValue / produced * 100) / 100 : costValue

  const updateConsumption = (idx: number, field: keyof ConsumptionEntry, value: string) => {
    setConsumptions((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    )
  }

  const buildBody = () => {
    const validConsumptions = consumptions
      .filter((c) => c.quantity && parseFloat(c.quantity) > 0)
      .map((c) => ({
        inventory_item_id: c.inventory_item_id,
        quantity: parseFloat(c.quantity),
        unit_cost: c.unit_cost ? parseFloat(c.unit_cost) : undefined,
        unit_of_measure: c.unit_of_measure,
        notes: c.notes || undefined,
      }))

    const body: any = {
      produced_quantity: produced,
    }
    if (rejected > 0) {
      body.rejected_quantity = rejected
      if (rejectionReason) body.rejection_reason = rejectionReason
      if (rejectionNotes.trim()) body.rejection_notes = rejectionNotes.trim()
    }
    if (costValue > 0) {
      body.partner_cost_estimate = costValue
      body.cost_type = costType
    }
    if (validConsumptions.length > 0) body.consumptions = validConsumptions
    if (completionNotes.trim()) body.notes = completionNotes.trim()
    return body
  }

  const handleSubmit = async () => {
    const body = buildBody()

    // Warn if no cost data
    if (!costValue && !isSample) {
      const confirmed = await prompt({
        title: "Complete without a cost estimate?",
        description: "No production cost entered. This helps with pricing and margin tracking.",
        confirmText: "Complete Anyway",
        cancelText: "Go Back",
      })
      if (!confirmed) return
    }

    // Sample runs: stricter — warn if no cost AND no materials
    if (isSample && !costValue && existingConsumptionCount === 0 && !body.consumptions?.length) {
      const confirmed = await prompt({
        title: "Complete sample without cost or material data?",
        description: "Sample runs need this data for cost estimation. Are you sure?",
        confirmText: "Complete Anyway",
        cancelText: "Go Back",
      })
      if (!confirmed) return
    }

    await onComplete(body)
  }

  return (
    <div className="px-6 py-4 bg-ui-bg-subtle">
      <Heading level="h3" className="mb-1">Complete Production Run</Heading>
      <Text size="xsmall" className="text-ui-fg-subtle mb-4">
        {runQuantity} piece{runQuantity !== 1 ? "s" : ""} ordered
        {isSample ? " · Sample run" : ""}
      </Text>

      {pendingTasks.length > 0 && (
        <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-3 mb-4">
          <Text size="small" weight="plus" className="text-ui-fg-subtle mb-1">
            {pendingTasks.length} pending task(s) will be marked as done
          </Text>
          <div className="flex flex-col gap-y-0.5">
            {pendingTasks.map((t: any) => (
              <Text key={t.id} size="xsmall" className="text-ui-fg-muted">
                &bull; {t.title || t.id}
              </Text>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: Output ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <Text size="small" weight="plus" className="mb-3">Output</Text>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Good pieces produced
            </Text>
            <Input
              type="number"
              min="0"
              max={runQuantity}
              step="1"
              value={producedQty}
              onChange={(e) => {
                setProducedQty(e.target.value)
                // Auto-calculate rejected
                const p = parseFloat(e.target.value) || 0
                const r = runQuantity - p
                if (r > 0) setRejectedQty(String(r))
                else setRejectedQty("")
              }}
            />
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Rejected
            </Text>
            <Input
              type="number"
              min="0"
              step="1"
              value={rejectedQty}
              onChange={(e) => setRejectedQty(e.target.value)}
            />
          </div>
        </div>

        {/* Yield indicator */}
        {produced > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ui-border-base">
            <StatusBadge color={yieldPct >= 90 ? "green" : yieldPct >= 70 ? "orange" : "red"}>
              {yieldPct}% yield
            </StatusBadge>
            <Text size="xsmall" className="text-ui-fg-muted">
              {produced} of {runQuantity} pieces
              {rejected > 0 ? ` · ${rejected} rejected` : ""}
            </Text>
          </div>
        )}

        {/* Rejection details */}
        {rejected > 0 && (
          <div className="mt-3 pt-3 border-t border-ui-border-base">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">Reason</Text>
                <Select value={rejectionReason} onValueChange={setRejectionReason}>
                  <Select.Trigger>
                    <Select.Value placeholder="Select reason" />
                  </Select.Trigger>
                  <Select.Content>
                    {REJECTION_REASONS.map((r) => (
                      <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">Details (optional)</Text>
                <Input
                  placeholder="e.g. thread pull on collar"
                  value={rejectionNotes}
                  onChange={(e) => setRejectionNotes(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 2: Cost ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <Text size="small" weight="plus" className="mb-1">
          Your production cost
          {isSample && <span className="text-ui-fg-error ml-1">*</span>}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle mb-3">
          {isSample
            ? "Your charge for producing this sample. This feeds directly into pricing."
            : "Your charge for this production run (labor, overheads, margin)."
          }
        </Text>

        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[200px]">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={partnerEstimate}
              onChange={(e) => setPartnerEstimate(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg border border-ui-border-base overflow-hidden">
            <button
              type="button"
              className={clx(
                "px-3 py-2 text-xs transition-colors",
                costType === "per_unit"
                  ? "bg-ui-bg-interactive text-ui-fg-on-color"
                  : "bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
              )}
              onClick={() => setCostType("per_unit")}
            >
              Per piece
            </button>
            <button
              type="button"
              className={clx(
                "px-3 py-2 text-xs transition-colors border-l border-ui-border-base",
                costType === "total"
                  ? "bg-ui-bg-interactive text-ui-fg-on-color"
                  : "bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover"
              )}
              onClick={() => setCostType("total")}
            >
              Total
            </button>
          </div>
        </div>

        {/* Cost summary */}
        {costValue > 0 && produced > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-ui-border-base">
            <Text size="xsmall" className="text-ui-fg-muted">
              {costType === "per_unit"
                ? `${costValue} × ${produced} pieces = ${totalCost} total`
                : `${totalCost} total · ${perUnitCost} per piece`
              }
            </Text>
          </div>
        )}
      </div>

      {/* ── Step 3: Materials ── */}
      <div className="rounded-xl border border-ui-border-base bg-ui-bg-base px-4 py-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <Text size="small" weight="plus">
            Materials
            {isSample && <span className="text-ui-fg-error ml-1">*</span>}
          </Text>
          {existingConsumptionCount > 0 && (
            <Badge size="2xsmall" color="green">
              {existingConsumptionCount} already logged
            </Badge>
          )}
        </div>

        {existingConsumptionCount > 0 ? (
          <Text size="xsmall" className="text-ui-fg-subtle mb-3">
            {existingConsumptionCount} material entry(ies) were logged during production.
            {inventoryItems.length > 0 ? " Add more below if needed." : ""}
          </Text>
        ) : (
          <Text size="xsmall" className="text-ui-fg-subtle mb-3">
            {isSample
              ? "No materials logged yet. Record what was consumed — this data is critical for cost estimation."
              : "Log materials consumed during this run (optional)."
            }
          </Text>
        )}

        {inventoryItems.length > 0 && !showMaterialForm && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => setShowMaterialForm(true)}
          >
            {existingConsumptionCount > 0 ? "Log additional materials" : "Log materials"}
          </Button>
        )}

        {showMaterialForm && inventoryItems.length > 0 && (
          <div className="flex flex-col gap-3 mt-3">
            {consumptions.map((entry, idx) => {
              const item = inventoryItems.find((i: any) => i.id === entry.inventory_item_id)
              const label = item?.title || item?.sku || entry.inventory_item_id
              return (
                <div key={entry.inventory_item_id} className="rounded-lg border border-ui-border-base p-3">
                  <Text size="xsmall" weight="plus" className="mb-2">{label}</Text>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Qty</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={entry.quantity}
                        onChange={(e) => updateConsumption(idx, "quantity", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Cost/unit</Text>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Optional"
                        value={entry.unit_cost}
                        onChange={(e) => updateConsumption(idx, "unit_cost", e.target.value)}
                      />
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Unit</Text>
                      <Select value={entry.unit_of_measure} onValueChange={(v) => updateConsumption(idx, "unit_of_measure", v)}>
                        <Select.Trigger><Select.Value /></Select.Trigger>
                        <Select.Content>
                          {UNIT_OPTIONS.map((o) => (
                            <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Notes</Text>
                      <Input
                        placeholder="Optional"
                        value={entry.notes}
                        onChange={(e) => updateConsumption(idx, "notes", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Step 4: Notes ── */}
      <div className="mb-4">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
          Completion notes (optional)
        </Text>
        <Textarea
          placeholder="Quality observations, issues, or feedback for the admin team"
          value={completionNotes}
          onChange={(e) => setCompletionNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex items-center justify-end gap-x-2 pt-2">
        <Button variant="secondary" size="small" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button size="small" onClick={handleSubmit} isLoading={isLoading}>
          Confirm & Complete
        </Button>
      </div>
    </div>
  )
}

// ── Inline Task Card ────────────────────────────────────────────────

const InlineTaskCard = ({ task }: { task: any }) => {
  const taskId = String(task.id)
  const status = String(task.status || "pending")
  const canAccept = status === "pending" || status === "assigned"
  const canFinish = status === "accepted" || status === "in_progress"
  const isCompleted = status === "completed"
  const subtasks = task.subtasks || []

  const acceptTask = useAcceptPartnerAssignedTask(taskId)
  const finishTask = useFinishPartnerAssignedTask(taskId)

  const handleAccept = async () => {
    try {
      await acceptTask.mutateAsync()
      toast.success(`Task "${task.title}" accepted`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinish = async () => {
    try {
      await finishTask.mutateAsync()
      toast.success(`Task "${task.title}" finished`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <div className="rounded-lg border border-ui-border-base p-3">
      <div className="flex items-start justify-between gap-x-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus" className="truncate">
              {String(task.title || task.id)}
            </Text>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          {task.description && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-1">
              {String(task.description)}
            </Text>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-x-2">
          {canAccept && (
            <Button size="small" variant="secondary" isLoading={acceptTask.isPending} onClick={handleAccept}>
              Accept
            </Button>
          )}
          {canFinish && (
            <Button size="small" isLoading={finishTask.isPending} onClick={handleFinish}>
              Finish
            </Button>
          )}
          {isCompleted && <Checkbox checked disabled className="mt-0.5" />}
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Subtasks ({subtasks.filter((s: any) => s.status === "completed").length}/{subtasks.length})
          </Text>
          <div className="flex flex-col gap-y-2">
            {subtasks.map((sub: any) => (
              <InlineSubtaskRow key={String(sub.id)} taskId={taskId} subtask={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline Subtask Row ──────────────────────────────────────────────

const InlineSubtaskRow = ({ taskId, subtask }: { taskId: string; subtask: any }) => {
  const subtaskId = String(subtask.id)
  const isCompleted = subtask.status === "completed"
  const complete = useCompletePartnerAssignedTaskSubtask(taskId, subtaskId)

  const handleComplete = async () => {
    try {
      await complete.mutateAsync()
      toast.success(`Subtask "${subtask.title}" completed`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <div className="flex items-center justify-between gap-x-3 rounded border border-ui-border-base px-3 py-2">
      <div className="flex items-center gap-x-2 min-w-0">
        <Checkbox
          checked={isCompleted}
          disabled={isCompleted || complete.isPending}
          onCheckedChange={() => {
            if (!isCompleted) handleComplete()
          }}
        />
        <Text size="xsmall" className={clx({ "line-through text-ui-fg-muted": isCompleted })}>
          {String(subtask.title || subtask.id)}
        </Text>
      </div>
      <Badge size="2xsmall" color={getStatusBadgeColor(String(subtask.status))}>
        {String(subtask.status).replace(/_/g, " ")}
      </Badge>
    </div>
  )
}
