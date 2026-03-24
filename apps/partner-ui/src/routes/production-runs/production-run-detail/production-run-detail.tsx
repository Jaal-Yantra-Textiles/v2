import { Badge, Button, Checkbox, Container, Heading, Text, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import {
  ActivitiesSection,
  ActivityItem,
} from "../../../components/common/activities-section"
import { JsonViewSection } from "../../../components/common/json-view-section"
import { SectionRow } from "../../../components/common/section"
import { TwoColumnPage, SingleColumnPage } from "../../../components/layout/pages"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import { extractErrorMessage } from "../../../lib/extract-error-message"
import {
  useAcceptPartnerProductionRun,
  useStartPartnerProductionRun,
  useFinishPartnerProductionRun,
  useCompletePartnerProductionRun,
  usePartnerProductionRun,
} from "../../../hooks/api/partner-production-runs"
import {
  useAcceptPartnerAssignedTask,
  useFinishPartnerAssignedTask,
  useCompletePartnerAssignedTaskSubtask,
} from "../../../hooks/api/partner-assigned-tasks"

export const ProductionRunDetail = () => {
  const { id } = useParams()

  const runId = id ?? ""

  const { production_run, tasks, isPending, isError, error } = usePartnerProductionRun(runId)
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

  const status = String(production_run?.status || "")
  const canAccept = status === "sent_to_partner"
  const canStart = status === "in_progress" && !production_run?.started_at
  const canFinish = status === "in_progress" && !!production_run?.started_at && !production_run?.finished_at
  const canComplete = status === "in_progress" && !!production_run?.finished_at

  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [
      {
        id: "created",
        title: "Run created",
        status: production_run?.created_at ? "Recorded" : "-",
        timestamp: production_run?.created_at,
      },
      {
        id: "updated",
        title: "Run updated",
        status: production_run?.updated_at ? "Recorded" : "-",
        timestamp: production_run?.updated_at,
      },
    ]

    if (production_run?.accepted_at) {
      items.push({
        id: "accepted",
        title: "Accepted",
        status: "Recorded",
        timestamp: production_run.accepted_at,
      })
    }

    if (production_run?.started_at) {
      items.push({
        id: "started",
        title: "Started",
        status: "Recorded",
        timestamp: production_run.started_at,
      })
    }

    if (production_run?.finished_at) {
      items.push({
        id: "finished",
        title: "Finished",
        status: "Recorded",
        timestamp: production_run.finished_at,
      })
    }

    if (production_run?.completed_at) {
      items.push({
        id: "completed",
        title: "Completed",
        status: "Recorded",
        timestamp: production_run.completed_at,
      })
    }

    if (production_run?.dispatch_started_at) {
      items.push({
        id: "dispatch_started",
        title: "Dispatch started",
        status: String(production_run.dispatch_state || "-"),
        timestamp: production_run.dispatch_started_at,
      })
    }

    if (production_run?.dispatch_completed_at) {
      items.push({
        id: "dispatch_completed",
        title: "Dispatch completed",
        status: "Recorded",
        timestamp: production_run.dispatch_completed_at,
      })
    }

    const completedCount = (tasks || []).filter(
      (t: any) => String(t?.status || "") === "completed"
    ).length
    const total = (tasks || []).length

    if (total) {
      items.push({
        id: "tasks_progress",
        title: "Tasks progress",
        status: `${completedCount} / ${total} completed`,
      })
    }

    return items
  }, [production_run, tasks])

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Production Run</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing production run id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  if (isError) {
    throw error
  }

  if (isPending || !production_run) {
    return <TwoColumnPageSkeleton mainSections={3} sidebarSections={2} showJSON />
  }

  return (
    <TwoColumnPage widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }} hasOutlet>
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>Production Run</Heading>
              <div className="mt-2 flex items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Status
                </Text>
                {production_run?.status ? (
                  <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                    {String(production_run.status)}
                  </Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">-</Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Role: {production_run?.role || "-"}
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              {canAccept && (
                <Button
                  size="small"
                  isLoading={accept.isPending}
                  onClick={() => accept.mutate()}
                >
                  Accept
                </Button>
              )}
              {canStart && (
                <Button
                  size="small"
                  isLoading={start.isPending}
                  onClick={() => start.mutate()}
                >
                  Start
                </Button>
              )}
              {canFinish && (
                <Button
                  size="small"
                  isLoading={finish.isPending}
                  onClick={() => finish.mutate()}
                >
                  Mark Finished
                </Button>
              )}
              {canComplete && (
                <Button
                  size="small"
                  isLoading={complete.isPending}
                  onClick={() => complete.mutate()}
                >
                  Complete
                </Button>
              )}
            </div>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Run ID" value={production_run?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              production_run?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                  {String(production_run.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow title="Type" value={production_run?.run_type === "sample" ? "Sample" : "Production"} />
          <SectionRow title="Quantity" value={production_run?.quantity != null ? String(production_run.quantity) : "-"} />
          <SectionRow title="Design" value={production_run?.design_id || "-"} />
          <SectionRow title="Parent run" value={production_run?.parent_run_id || "-"} />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Tasks</Heading>
          </div>
          <div className="px-6 py-4">
            {tasks?.length ? (
              <div className="flex flex-col gap-y-3">
                {tasks.map((t: any) => (
                  <TaskCard key={String(t.id)} task={t} />
                ))}
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No tasks
              </Text>
            )}
          </div>
        </Container>

        {production_run && (
          <div className="xl:hidden">
            <JsonViewSection data={production_run as any} />
          </div>
        )}
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        <ActivitiesSection title="Activity" items={activity} />
        {production_run && (
          <div className="hidden xl:block">
            <JsonViewSection data={production_run as any} />
          </div>
        )}
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}

// ── Inline Task Card ─────────────────────────────────────────────────

const TaskCard = ({ task }: { task: any }) => {
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
    <div className="rounded-lg border p-4">
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
          {isCompleted && (
            <Checkbox checked disabled className="mt-0.5" />
          )}
        </div>
      </div>

      {subtasks.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle mb-2">
            Subtasks ({subtasks.filter((s: any) => s.status === "completed").length}/{subtasks.length})
          </Text>
          <div className="flex flex-col gap-y-2">
            {subtasks.map((sub: any) => (
              <SubtaskRow key={String(sub.id)} taskId={taskId} subtask={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const SubtaskRow = ({
  taskId,
  subtask,
}: {
  taskId: string
  subtask: any
}) => {
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
