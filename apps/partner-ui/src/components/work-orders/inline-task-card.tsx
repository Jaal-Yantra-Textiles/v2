import {
  Badge,
  Button,
  Checkbox,
  Input,
  Text,
  clx,
  toast,
} from "@medusajs/ui"
import { useState } from "react"
import { Link } from "react-router-dom"
import { useAcceptPartnerAssignedTask, useCompletePartnerAssignedTaskSubtask, useFinishPartnerAssignedTask } from "../../hooks/api/partner-assigned-tasks"
import { extractErrorMessage } from "../../lib/extract-error-message"
import { getStatusBadgeColor } from "../../lib/status-badge"

export const InlineTaskCard = ({ task, linkBase }: { task: any; linkBase?: string }) => {
  const taskId = String(task.id)
  const status = String(task.status || "pending")
  const canAccept = status === "pending" || status === "assigned"
  const canFinish = status === "accepted" || status === "in_progress"
  const isCompleted = status === "completed"
  const subtasks = task.subtasks || []

  const [showCostInput, setShowCostInput] = useState(false)
  const [actualCost, setActualCost] = useState("")

  const acceptTask = useAcceptPartnerAssignedTask(taskId)
  const finishTask = useFinishPartnerAssignedTask(taskId)

  const estimatedCost = task.estimated_cost ? Number(task.estimated_cost) : null
  const completedCost = task.actual_cost ? Number(task.actual_cost) : null

  const handleAccept = async () => {
    try {
      await acceptTask.mutateAsync()
      toast.success(`Task "${task.title}" accepted`)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinishClick = () => {
    // If task has an estimated cost, show cost input before finishing
    if (estimatedCost || estimatedCost === 0) {
      setShowCostInput(true)
      setActualCost(estimatedCost ? String(estimatedCost) : "")
    } else {
      setShowCostInput(true)
      setActualCost("")
    }
  }

  const handleFinishConfirm = async () => {
    try {
      const cost = actualCost ? parseFloat(actualCost) : undefined
      await finishTask.mutateAsync(
        cost && cost > 0 ? { actual_cost: cost } : undefined
      )
      toast.success(`Task "${task.title}" finished`)
      setShowCostInput(false)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const handleFinishSkip = async () => {
    try {
      // Explicit `undefined`: the mutation's variables argument is required
      // by its inferred type, and the hook already sends `{}` for no payload.
      await finishTask.mutateAsync(undefined)
      toast.success(`Task "${task.title}" finished`)
      setShowCostInput(false)
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  return (
    <div className="rounded-lg border border-ui-border-base p-3">
      <div className="flex items-start justify-between gap-x-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            {linkBase ? (
              <Link
                to={`${linkBase}/${taskId}`}
                className="truncate text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              >
                <Text size="small" weight="plus" className="truncate">
                  {String(task.title || task.id)}
                </Text>
              </Link>
            ) : (
              <Text size="small" weight="plus" className="truncate">
                {String(task.title || task.id)}
              </Text>
            )}
            <Badge size="2xsmall" color={getStatusBadgeColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          {task.description && (
            <Text size="xsmall" className="text-ui-fg-subtle mt-1">
              {String(task.description)}
            </Text>
          )}
          {/* Show cost info */}
          {(estimatedCost || completedCost) && (
            <div className="flex items-center gap-2 mt-1">
              {estimatedCost != null && (
                <Text size="xsmall" className="text-ui-fg-muted">
                  Est: {estimatedCost}
                </Text>
              )}
              {completedCost != null && (
                <Text size="xsmall" weight="plus">
                  Actual: {completedCost}
                </Text>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-x-2">
          {canAccept && (
            <Button size="small" variant="secondary" isLoading={acceptTask.isPending} onClick={handleAccept}>
              Accept
            </Button>
          )}
          {canFinish && !showCostInput && (
            <Button size="small" isLoading={finishTask.isPending} onClick={handleFinishClick}>
              Finish
            </Button>
          )}
          {isCompleted && <Checkbox checked disabled className="mt-0.5" />}
        </div>
      </div>

      {/* Cost input when finishing */}
      {showCostInput && canFinish && (
        <div className="mt-3 pt-3 border-t border-ui-border-base">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-1">
            Your cost for this work (optional)
          </Text>
          {estimatedCost != null && (
            <Text size="xsmall" className="text-ui-fg-muted mb-2">
              Estimated: {estimatedCost}
            </Text>
          )}
          <div className="flex items-end gap-2">
            <div className="max-w-[160px]">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={estimatedCost ? String(estimatedCost) : "0.00"}
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
              />
            </div>
            <Button size="small" variant="secondary" onClick={handleFinishSkip} isLoading={finishTask.isPending}>
              Skip
            </Button>
            <Button size="small" onClick={handleFinishConfirm} isLoading={finishTask.isPending}>
              Finish
            </Button>
          </div>
        </div>
      )}

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

export const InlineSubtaskRow = ({ taskId, subtask }: { taskId: string; subtask: any }) => {
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
