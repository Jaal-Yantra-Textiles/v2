import { Badge, Button, Checkbox, Container, Heading, Text, toast } from "@medusajs/ui"
import { Link } from "react-router-dom"

import { PartnerDesign } from "../../../../hooks/api/partner-designs"
import {
  usePartnerProductionRuns,
  useAcceptPartnerProductionRun,
  useStartPartnerProductionRun,
  useFinishPartnerProductionRun,
  useCompletePartnerProductionRun,
} from "../../../../hooks/api/partner-production-runs"
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
    return null // Don't show section if no runs — design actions handle v1 flow
  }

  return (
    <>
      {production_runs.map((run: any) => (
        <ProductionRunCard key={String(run.id)} run={run} />
      ))}
    </>
  )
}

// ── Progress Steps ──────────────────────────────────────────────────

const STEPS = [
  { key: "sent_to_partner", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "started", label: "Started" },
  { key: "finished", label: "Finished" },
  { key: "completed", label: "Completed" },
]

const ProgressStepper = ({ run }: { run: any }) => {
  const status = String(run.status || "")
  if (status === "cancelled") return null

  // Determine current step index
  let currentIdx = 0
  if (run.completed_at) currentIdx = 4
  else if (run.finished_at) currentIdx = 3
  else if (run.started_at) currentIdx = 2
  else if (run.accepted_at) currentIdx = 1
  else if (status === "sent_to_partner") currentIdx = 0

  return (
    <div className="flex items-center gap-1 px-6 py-3">
      {STEPS.map((step, idx) => {
        const isDone = idx <= currentIdx
        const isCurrent = idx === currentIdx
        return (
          <div key={step.key} className="flex items-center gap-1 flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`h-1.5 w-full rounded-full ${
                  isDone
                    ? "bg-ui-fg-interactive"
                    : "bg-ui-border-base"
                }`}
              />
              <Text
                size="xsmall"
                className={`mt-1 ${
                  isCurrent
                    ? "text-ui-fg-base font-medium"
                    : isDone
                    ? "text-ui-fg-subtle"
                    : "text-ui-fg-muted"
                }`}
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

// ── Production Run Card ─────────────────────────────────────────────

const ProductionRunCard = ({ run }: { run: any }) => {
  const runId = String(run.id)
  const status = String(run.status || "")
  const tasks = run.tasks || []

  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run accepted"),
  })
  const start = useStartPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run started"),
  })
  const finish = useFinishPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run finished"),
  })
  const complete = useCompletePartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run completed"),
  })

  const isCancelled = status === "cancelled"
  const isCompleted = status === "completed"
  const canAccept = !isCancelled && status === "sent_to_partner"
  const canStart = !isCancelled && status === "in_progress" && !run.started_at
  const canFinish = !isCancelled && status === "in_progress" && !!run.started_at && !run.finished_at
  const canComplete = !isCancelled && status === "in_progress" && !!run.finished_at

  const completedTasks = tasks.filter((t: any) => String(t.status) === "completed").length
  const totalTasks = tasks.length

  // Derive the primary action
  const primaryAction = canAccept
    ? { label: "Accept Run", onClick: () => accept.mutate(), loading: accept.isPending }
    : canStart
    ? { label: "Start Working", onClick: () => start.mutate(), loading: start.isPending }
    : canFinish
    ? { label: "Mark Finished", onClick: () => finish.mutate(), loading: finish.isPending }
    : canComplete
    ? { label: "Complete Run", onClick: () => complete.mutate(), loading: complete.isPending }
    : null

  return (
    <Container className={`divide-y p-0${isCancelled ? " opacity-60" : ""}`}>
      {/* Header with status + primary action */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h2">Production</Heading>
            <Badge size="2xsmall" color={run.run_type === "sample" ? "blue" : "grey"}>
              {run.run_type === "sample" ? "Sample" : "Production"}
            </Badge>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Qty: {run.quantity ?? "-"}
            {run.role ? ` · ${run.role}` : ""}
            {totalTasks > 0 ? ` · ${completedTasks}/${totalTasks} tasks done` : ""}
          </Text>
          {isCancelled && (
            <Text size="xsmall" className="text-ui-fg-error mt-1">
              This production run has been cancelled by the admin.
            </Text>
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
          {isCompleted && (
            <Badge color="green" size="small">Done</Badge>
          )}
        </div>
      </div>

      {/* Progress stepper */}
      <ProgressStepper run={run} />

      {/* Timeline details */}
      {(run.accepted_at || run.started_at || run.finished_at || run.completed_at) && (
        <div className="px-6 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {run.accepted_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Accepted: {new Date(run.accepted_at).toLocaleDateString()}
              </Text>
            )}
            {run.started_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Started: {new Date(run.started_at).toLocaleDateString()}
              </Text>
            )}
            {run.finished_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Finished: {new Date(run.finished_at).toLocaleDateString()}
              </Text>
            )}
            {run.completed_at && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Completed: {new Date(run.completed_at).toLocaleDateString()}
              </Text>
            )}
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
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-x-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <Text size="small" weight="plus" className="truncate">
              {String(task.title || task.id)}
            </Text>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status}
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
            <Button
              size="small"
              variant="secondary"
              isLoading={acceptTask.isPending}
              onClick={handleAccept}
            >
              Accept
            </Button>
          )}
          {canFinish && (
            <Button
              size="small"
              isLoading={finishTask.isPending}
              onClick={handleFinish}
            >
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
    <div className="flex items-center justify-between gap-x-3 rounded border px-3 py-2">
      <div className="flex items-center gap-x-2 min-w-0">
        <Checkbox
          checked={isCompleted}
          disabled={isCompleted || complete.isPending}
          onCheckedChange={() => {
            if (!isCompleted) handleComplete()
          }}
        />
        <Text
          size="xsmall"
          className={isCompleted ? "line-through text-ui-fg-muted" : ""}
        >
          {String(subtask.title || subtask.id)}
        </Text>
      </div>
      <Badge size="2xsmall" color={getStatusBadgeColor(String(subtask.status))}>
        {String(subtask.status)}
      </Badge>
    </div>
  )
}
