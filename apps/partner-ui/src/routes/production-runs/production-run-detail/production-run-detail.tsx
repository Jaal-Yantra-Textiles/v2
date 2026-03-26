import { Badge, Button, Checkbox, Container, Heading, Input, Select, Text, toast, usePrompt } from "@medusajs/ui"
import { useMemo, useState } from "react"
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

const formatStatus = (s: string) => s.replace(/_/g, " ")

const formatDate = (d: string | undefined) => {
  if (!d) return "-"
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export const ProductionRunDetail = () => {
  const { id } = useParams()
  const runId = id ?? ""
  const prompt = usePrompt()
  const [showCompleteForm, setShowCompleteForm] = useState(false)

  const { production_run, tasks, isPending, isError, error } = usePartnerProductionRun(runId)
  const accept = useAcceptPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run accepted"),
  })
  const start = useStartPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run started"),
  })
  const finish = useFinishPartnerProductionRun(runId, {
    onSuccess: () => toast.success("Run marked as finished"),
  })
  const complete = useCompletePartnerProductionRun(runId, {
    onSuccess: () => {
      toast.success("Run completed")
      setShowCompleteForm(false)
    },
  })

  const status = String(production_run?.status || "")
  const isCancelled = status === "cancelled"
  const canAccept = !isCancelled && status === "sent_to_partner"
  const canStart = !isCancelled && status === "in_progress" && !production_run?.started_at
  const canFinish = !isCancelled && status === "in_progress" && !!production_run?.started_at && !production_run?.finished_at
  const canComplete = !isCancelled && status === "in_progress" && !!production_run?.finished_at

  const pendingTasks = (tasks || []).filter(
    (t: any) => t.status !== "completed" && t.status !== "cancelled"
  )

  const handleAccept = async () => {
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

  const handleFinish = async () => {
    if (pendingTasks.length > 0) {
      const confirmed = await prompt({
        title: "Pending Tasks",
        description: `${pendingTasks.length} task(s) are still pending. Marking as finished will proceed regardless. Continue?`,
        confirmText: "Mark Finished",
        cancelText: "Go Back",
      })
      if (!confirmed) return
    }
    try {
      await finish.mutateAsync()
    } catch (e) {
      toast.error(extractErrorMessage(e))
    }
  }

  const activity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = []

    if (production_run?.accepted_at) {
      items.push({ id: "accepted", title: "Accepted", status: "Recorded", timestamp: production_run.accepted_at })
    }
    if (production_run?.started_at) {
      items.push({ id: "started", title: "Started", status: "Recorded", timestamp: production_run.started_at })
    }
    if (production_run?.finished_at) {
      items.push({ id: "finished", title: "Finished", status: "Recorded", timestamp: production_run.finished_at })
    }
    if (production_run?.completed_at) {
      items.push({ id: "completed", title: "Completed", status: "Recorded", timestamp: production_run.completed_at })
    }

    const completedCount = (tasks || []).filter((t: any) => String(t?.status) === "completed").length
    const total = (tasks || []).length
    if (total) {
      items.push({ id: "tasks_progress", title: "Tasks progress", status: `${completedCount} / ${total} completed` })
    }

    return items
  }, [production_run, tasks])

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Production Run</Heading>
          <Text size="small" className="text-ui-fg-subtle">Missing production run id</Text>
        </Container>
      </SingleColumnPage>
    )
  }

  if (isError) throw error
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
                <Badge size="2xsmall" color={production_run.run_type === "sample" ? "blue" : "grey"}>
                  {production_run.run_type === "sample" ? "Sample" : "Production"}
                </Badge>
                <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                  {formatStatus(String(production_run.status))}
                </Badge>
              </div>
              {production_run.role && (
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Role: {production_run.role}
                </Text>
              )}
              {isCancelled && (
                <Text size="small" className="text-ui-fg-error mt-1">
                  This production run has been cancelled.
                </Text>
              )}
            </div>
            <div className="flex items-center gap-x-2">
              {canAccept && (
                <Button size="small" isLoading={accept.isPending} onClick={handleAccept}>
                  Accept Run
                </Button>
              )}
              {canStart && (
                <Button size="small" isLoading={start.isPending} onClick={handleStart}>
                  Start Working
                </Button>
              )}
              {canFinish && (
                <Button size="small" isLoading={finish.isPending} onClick={handleFinish}>
                  Mark Finished
                </Button>
              )}
              {canComplete && (
                <Button size="small" isLoading={complete.isPending} onClick={() => setShowCompleteForm(!showCompleteForm)}>
                  Complete Run
                </Button>
              )}
            </div>
          </div>
        </Container>

        {/* Complete form */}
        {showCompleteForm && canComplete && (
          <Container className="p-0">
            <div className="px-6 py-4 bg-ui-bg-subtle">
              <Heading level="h3" className="mb-3">Complete Production Run</Heading>

              {pendingTasks.length > 0 && (
                <div className="mb-3 rounded-md border p-3 bg-ui-bg-base">
                  <Text size="small" weight="plus" className="text-ui-fg-on-color-disabled mb-1">
                    {pendingTasks.length} pending task(s) will be marked as done
                  </Text>
                  {pendingTasks.map((t: any) => (
                    <Text key={t.id} size="xsmall" className="text-ui-fg-subtle">
                      • {t.title || t.id}
                    </Text>
                  ))}
                </div>
              )}

              <Text size="small" className="text-ui-fg-subtle mb-3">
                Are you sure you want to complete this run? This action cannot be undone.
              </Text>

              <div className="flex justify-end gap-x-2">
                <Button variant="secondary" size="small" onClick={() => setShowCompleteForm(false)}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  isLoading={complete.isPending}
                  onClick={async () => {
                    try {
                      await complete.mutateAsync()
                    } catch (e) {
                      toast.error(extractErrorMessage(e))
                    }
                  }}
                >
                  Confirm & Complete
                </Button>
              </div>
            </div>
          </Container>
        )}

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Run ID" value={production_run?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              <Badge size="2xsmall" color={getStatusBadgeColor(production_run.status)}>
                {formatStatus(String(production_run.status))}
              </Badge>
            }
          />
          <SectionRow title="Type" value={production_run.run_type === "sample" ? "Sample" : "Production"} />
          <SectionRow title="Quantity" value={production_run.quantity != null ? String(production_run.quantity) : "-"} />
          <SectionRow
            title="Design"
            value={
              production_run.design_id ? (
                <Link to={`/designs/${production_run.design_id}`} className="text-ui-fg-interactive hover:underline">
                  {production_run.design_id}
                </Link>
              ) : "-"
            }
          />
          {production_run.parent_run_id && (
            <SectionRow
              title="Parent run"
              value={
                <Link to={`/production-runs/${production_run.parent_run_id}`} className="text-ui-fg-interactive hover:underline">
                  {production_run.parent_run_id}
                </Link>
              }
            />
          )}
          {production_run.accepted_at && (
            <SectionRow title="Accepted" value={formatDate(production_run.accepted_at)} />
          )}
          {production_run.started_at && (
            <SectionRow title="Started" value={formatDate(production_run.started_at)} />
          )}
          {production_run.finished_at && (
            <SectionRow title="Finished" value={formatDate(production_run.finished_at)} />
          )}
          {production_run.completed_at && (
            <SectionRow title="Completed" value={formatDate(production_run.completed_at)} />
          )}
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
              <Text size="small" className="text-ui-fg-subtle">No tasks</Text>
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

// ── Task Card ─────────────────────────────────────────────────────

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
              {formatStatus(status)}
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
              <SubtaskRow key={String(sub.id)} taskId={taskId} subtask={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const SubtaskRow = ({ taskId, subtask }: { taskId: string; subtask: any }) => {
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
          onCheckedChange={() => { if (!isCompleted) handleComplete() }}
        />
        <Text size="xsmall" className={isCompleted ? "line-through text-ui-fg-muted" : ""}>
          {String(subtask.title || subtask.id)}
        </Text>
      </div>
      <Badge size="2xsmall" color={getStatusBadgeColor(String(subtask.status))}>
        {formatStatus(String(subtask.status))}
      </Badge>
    </div>
  )
}
