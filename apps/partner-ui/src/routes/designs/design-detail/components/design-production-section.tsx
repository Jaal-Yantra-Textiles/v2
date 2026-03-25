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
          <Heading level="h2">Production Runs</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (!production_runs.length) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Production Runs</Heading>
        </div>
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            No production runs assigned for this design.
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <>
      {production_runs.map((run: any) => (
        <ProductionRunCard key={String(run.id)} run={run} />
      ))}
    </>
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

  const canAccept = status === "sent_to_partner"
  const canStart = status === "in_progress" && !run.started_at
  const canFinish = status === "in_progress" && !!run.started_at && !run.finished_at
  const canComplete = status === "in_progress" && !!run.finished_at

  const completedTasks = tasks.filter((t: any) => String(t.status) === "completed").length
  const totalTasks = tasks.length

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h2">Production Run</Heading>
            <Badge size="2xsmall" color={run.run_type === "sample" ? "blue" : "grey"}>
              {run.run_type === "sample" ? "Sample" : "Production"}
            </Badge>
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle mt-1">
            Qty: {run.quantity ?? "-"}
            {run.role ? ` · Role: ${run.role}` : ""}
            {totalTasks > 0 ? ` · Tasks: ${completedTasks}/${totalTasks}` : ""}
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          {canAccept && (
            <Button size="small" isLoading={accept.isPending} onClick={() => accept.mutate()}>
              Accept
            </Button>
          )}
          {canStart && (
            <Button size="small" isLoading={start.isPending} onClick={() => start.mutate()}>
              Start
            </Button>
          )}
          {canFinish && (
            <Button size="small" isLoading={finish.isPending} onClick={() => finish.mutate()}>
              Mark Finished
            </Button>
          )}
          {canComplete && (
            <Button size="small" isLoading={complete.isPending} onClick={() => complete.mutate()}>
              Complete
            </Button>
          )}
          <Button size="small" variant="secondary" asChild>
            <Link to={`/production-runs/${runId}`}>View Details</Link>
          </Button>
        </div>
      </div>

      {/* Timeline */}
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
          {!run.accepted_at && !run.started_at && !run.finished_at && !run.completed_at && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Created: {run.created_at ? new Date(run.created_at).toLocaleDateString() : "-"}
            </Text>
          )}
        </div>
      </div>

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
