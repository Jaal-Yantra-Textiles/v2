import {
  Alert,
  Badge,
  Container,
  Heading,
  StatusBadge,
  Text,
  clx,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import { PartnerDesign } from "../../hooks/api/partner-designs"
import { useAcceptPartnerProductionRun, useCompletePartnerProductionRun, useFinishPartnerProductionRun, useStartPartnerProductionRun } from "../../hooks/api/partner-production-runs"
import { useMe } from "../../hooks/api/users"
import { extractErrorMessage } from "../../lib/extract-error-message"
import { getReassignmentNotice } from "../../lib/reassignment-notice"
import { GoodsTransferSection } from "./goods-transfer-section"
import { RunNextAction } from "./run-next-action"
import type { RunActionKey } from "../../lib/run-phase"
import { durationBetween, formatCost, getTargetDateStatus, runStatusColor } from "../../lib/run-formatting"
import { ProgressStepper } from "./run-progress-stepper"
import { TimelineItem } from "./run-timeline-item"
import { InfoBanner } from "./run-info-banner"
import { FinishRunForm } from "./finish-run-form"
import { CompleteRunForm } from "./complete-run-form"
import { InlineTaskCard } from "./inline-task-card"

/**
 * The work surface for a single production run: status, progress stepper,
 * contextual guidance, timeline, tasks/subtasks, and the
 * Accept/Start/Finish/Complete lifecycle actions.
 *
 * Shared (#342): rendered N-up by `DesignProductionSection` on `/designs/:id`,
 * and 1-up by the unified order detail (`/orders/:id`) for design work-orders.
 * `onActionSuccess` lets the order detail refetch the unified order so its
 * work-status badge follows a lifecycle transition.
 */
export const ProductionRunCard = ({
  run,
  design,
  consumptionLogs = [],
  consumptionCount = 0,
  onActionSuccess,
  showTimeline = true,
  taskLinkBase,
}: {
  run: any
  design: PartnerDesign
  consumptionLogs?: any[]
  consumptionCount?: number
  onActionSuccess?: () => void
  /** When false, the lifecycle timeline is omitted (the order detail renders it
   * in the sidebar Activity section instead). Defaults to true (design page). */
  showTimeline?: boolean
  /** When set (#342, order context), each task title links to the run-task
   * drawer at `${taskLinkBase}/${task.id}` (relative to the order detail, i.e.
   * `/orders/:id/tasks/:task_id`). Omitted on the design page — no drawer there. */
  taskLinkBase?: string
}) => {
  const runId = String(run.id)
  const status = String(run.status || "")
  const tasks = run.tasks || []
  const isSample = run.run_type === "sample"
  const prompt = usePrompt()

  // #1228 — how this run got here. Needs the viewer's own partner id to tell
  // "re-assigned to you from someone else" apart from a run handed back to you.
  const { user } = useMe()
  const reassignmentNotice = getReassignmentNotice(run, user?.partner_id)

  const [showFinishForm, setShowFinishForm] = useState(false)
  const [showCompleteForm, setShowCompleteForm] = useState(false)
  const [finishNotes, setFinishNotes] = useState("")

  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run accepted")
      onActionSuccess?.()
    },
  })
  const start = useStartPartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run started")
      onActionSuccess?.()
    },
  })
  const finish = useFinishPartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run finished — admin will review")
      onActionSuccess?.()
    },
  })
  const complete = useCompletePartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run completed")
      setShowCompleteForm(false)
      onActionSuccess?.()
    },
  })

  const isCancelled = status === "cancelled"
  const isCompleted = status === "completed"
  // Defence-in-depth: if the partner's assignment for this design is
  // cancelled, no run actions are permitted even if a non-cancelled run
  // lingers (cancelling the assignment now also cancels the run, but this
  // guards runs that predate that fix). The run's own status still gates
  // the individual transitions below.
  const assignmentCancelled = design?.partner_info?.partner_status === "cancelled"
  const actionable = !isCancelled && !assignmentCancelled
  const canAccept = actionable && status === "sent_to_partner"
  const canStart = actionable && status === "in_progress" && !run.started_at
  const canFinish = actionable && status === "in_progress" && !!run.started_at && !run.finished_at
  const canComplete = actionable && status === "in_progress" && !!run.finished_at

  const completedTasks = tasks.filter((t: any) => String(t.status) === "completed").length
  const totalTasks = tasks.length
  const pendingTasks = tasks.filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )

  const targetDateInfo = getTargetDateStatus((design as any)?.target_completion_date)

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

  /**
   * #2018 — `RunNextAction` decides WHICH action to offer (one derivation, unit
   * tested); the card still owns how to run it. This map is the whole seam.
   *
   * The old code derived the button here from `can*` and the guidance banner
   * separately from a stage-guidance helper — the same state, twice.
   */
  const runAction = (key: RunActionKey) => {
    if (key === "accept") return handleAccept()
    if (key === "start") return handleStart()
    if (key === "finish") return handleFinishClick()
    return handleCompleteClick()
  }
  const actionPending =
    accept.isPending || start.isPending || finish.isPending || complete.isPending

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
      <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
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
      </div>

      {/* #2018 — the action first. Above the reassignment notice, the stepper
          and every section: this is what the partner came here to do. */}
      <RunNextAction
        run={run}
        isSample={isSample}
        actionable={actionable}
        isPending={actionPending}
        onAction={runAction}
      />

      {/* #1228 — how this run reached the partner. Sits ABOVE the stepper: a
          re-sent run and a fresh one are otherwise identical on screen, and
          "you're on your last chance to accept this" has to be read before the
          Accept button, not after it. */}
      {reassignmentNotice && (
        <InfoBanner
          title={reassignmentNotice.title}
          description={reassignmentNotice.description}
          variant={reassignmentNotice.variant}
        />
      )}

      {/* Progress stepper */}
      <ProgressStepper run={run} />

      {/* Sample run emphasis — shown from accept onwards (not just after start) */}
      {isSample && !isCancelled && !isCompleted && run.accepted_at && (
        <InfoBanner
          title="Sample run — material tracking is essential"
          description="Log all materials used so the design cost can be estimated accurately."
          variant="warning"
        />
      )}

      {/* Inline tips — stage-specific workflow help */}
      {!isCancelled && !isCompleted && (
        <div className="px-6 py-2">
          {canAccept && (
            <Alert variant="info" dismissible>
              {/* #2018 — this used to say "review the design specifications…"
                  full stop, which stopped being true the moment those sections
                  moved behind Details. It now says WHERE they are. */}
              Open <strong>Details</strong> to review the design specifications,
              inventory items and task list before accepting. Once accepted, you
              are committing to deliver {run.quantity} piece{run.quantity !== 1 ? "s" : ""}.
            </Alert>
          )}
          {canStart && (
            <Alert variant="info" dismissible>
              Before starting, ensure you have the required materials in stock.
              {isSample ? " Log materials as you go — this data sets the price for future orders." : ""}
            </Alert>
          )}
          {canFinish && consumptionCount === 0 && (
            <Alert variant="warning" dismissible>
              No materials have been logged yet. Use the Material Usage section below to record what you've consumed before marking as finished.
            </Alert>
          )}
          {canComplete && (
            <Alert variant="info" dismissible>
              Complete the run by entering your output count, production cost, and any final material logs.
              {isSample ? " Accurate data here directly impacts the design's pricing." : ""}
            </Alert>
          )}
        </div>
      )}

      {/* Finish confirmation — Medusa side drawer */}
      {canFinish && (
        <FinishRunForm
          open={showFinishForm}
          onOpenChange={(o) => { setShowFinishForm(o); if (!o) setFinishNotes("") }}
          pendingTasks={pendingTasks}
          finishNotes={finishNotes}
          setFinishNotes={setFinishNotes}
          onConfirm={handleFinishConfirm}
          isLoading={finish.isPending}
          isSample={isSample}
          consumptionCount={consumptionCount}
        />
      )}

      {/* Complete confirmation — Medusa focus modal (multi-step input) */}
      {canComplete && (
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
              setShowCompleteForm(false)
            } catch (e) {
              toast.error(extractErrorMessage(e))
            }
          }}
          open={showCompleteForm}
          onOpenChange={setShowCompleteForm}
          isLoading={complete.isPending}
          isSample={isSample}
          existingConsumptionCount={consumptionCount}
        />
      )}

      {/* Where the output goes next (#891). Completed runs only — before that
          there is nothing produced to move. */}
      <GoodsTransferSection runId={runId} isCompleted={isCompleted} />

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
      {/* Boolean, not the last truthy operand — a cost of 0 with no notes
          would otherwise render a bare 0 where the section should be. */}
      {Boolean(
        run.finish_notes || run.completion_notes || run.partner_cost_estimate != null
      ) && (
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
                  {formatCost(run.partner_cost_estimate, (design as any)?.cost_currency)}
                  {run.cost_type === "per_unit" && run.produced_quantity
                    ? ` × ${run.produced_quantity} = ${formatCost(Math.round(run.partner_cost_estimate * run.produced_quantity * 100) / 100, (design as any)?.cost_currency)}`
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
      {showTimeline && timelineEntries.length > 0 && (
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
              <InlineTaskCard key={String(t.id)} task={t} linkBase={taskLinkBase} />
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}
