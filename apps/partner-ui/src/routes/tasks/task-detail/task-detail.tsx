import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import {
  ActivitiesSection,
  ActivityItem,
} from "../../../components/common/activities-section"
import { JsonViewSection } from "../../../components/common/json-view-section"
import { SectionRow } from "../../../components/common/section"
import { TwoColumnPageSkeleton } from "../../../components/common/skeleton"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  usePartnerAssignedTask,
} from "../../../hooks/api/partner-assigned-tasks"
import { TaskActionsSection } from "./components/task-actions-section"

export const TaskDetail = () => {
  const { id } = useParams()

  const { task, isPending, isError, error } = usePartnerAssignedTask(id || "", {
    enabled: !!id,
  })

  const workflowType = (task?.metadata as any)?.workflow_config?.type
  const isSequential = workflowType === "sequential"

  const subtasksSorted = useMemo(() => {
    const list = (task?.subtasks || []) as any[]

    return [...list].sort((a, b) => {
      const orderA = (a?.metadata as any)?.order ?? 0
      const orderB = (b?.metadata as any)?.order ?? 0
      return orderA - orderB
    })
  }, [task?.subtasks])

  const completedCount = useMemo(() => {
    return subtasksSorted.filter((st) => String(st.status) === "completed").length
  }, [subtasksSorted])

  const totalCount = subtasksSorted.length

  const nextSubtask = useMemo(() => {
    return subtasksSorted.find((st) => String(st.status) !== "completed")
  }, [subtasksSorted])

  const activitySummary = useMemo(() => {
    const items: ActivityItem[] = [
      {
        id: "created",
        title: "Task created",
        status: task?.created_at ? "Recorded" : "-",
        timestamp: task?.created_at,
      },
      {
        id: "updated",
        title: "Task updated",
        status: task?.updated_at ? "Recorded" : "-",
        timestamp: task?.updated_at,
      },
    ]

    if (totalCount > 0) {
      items.push({
        id: "subtasks_progress",
        title: "Subtasks progress",
        status: `${completedCount} / ${totalCount} completed`,
      })
    }

    if (isSequential && nextSubtask) {
      items.push({
        id: "next_step",
        title: "Next step",
        status: String(nextSubtask.title || nextSubtask.id),
      })
    }

    if (task?.completed_at) {
      items.push({
        id: "completed",
        title: "Task completed",
        status: "Recorded",
        timestamp: task.completed_at,
      })
    }

    return items
  }, [completedCount, isSequential, nextSubtask, task, totalCount])

  /*
   * 🔴 EVERY HOOK ABOVE, EVERY GUARD BELOW.
   *
   * These three returns used to sit between `usePartnerAssignedTask` and the
   * four `useMemo`s under it. So the first render — pending, no task — ran two
   * hooks, and the render after the fetch resolved ran six. React counts hooks
   * per render and refuses when the number changes: "Rendered more hooks than
   * during the previous render" (minified #310), which is a thrown error, not a
   * degraded page.
   *
   * ⚠️ AND IT WAS INTERMITTENT, which is why it survived. A task already in the
   * react-query cache — arriving from the list, or a revisit — resolves on the
   * first render, the early return never fires, and the page loads perfectly.
   * Cold-load it and it crashes. "Sometimes it works" was the symptom that made
   * this look like a data problem for days; the data was never wrong.
   *
   * The memos all read `task?.` and cope with undefined, so hoisting them costs
   * nothing.
   */
  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Task</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing task id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  if (isError) {
    throw error
  }

  if (isPending || !task) {
    return <TwoColumnPageSkeleton mainSections={5} sidebarSections={2} />
  }

  return (
    <TwoColumnPage
      widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}
      hasOutlet
    >
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Heading>{task?.title || "Task"}</Heading>
              <div className="mt-2 flex items-center gap-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Status
                </Text>
                {task?.status ? (
                  <Badge size="2xsmall" color={getStatusBadgeColor(task.status)}>
                    {String(task.status)}
                  </Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">
                    -
                  </Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                Priority: {task?.priority || "-"}
              </Text>
            </div>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Task ID" value={task?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              task?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(task.status)}>
                  {String(task.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow title="Priority" value={task?.priority || "-"} />
        </Container>
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Description</Heading>
          </div>
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              {task?.description || "-"}
            </Text>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Subtasks</Heading>
          </div>
          <div className="px-6 py-4">
            <div className="flex flex-col gap-y-2">
              {task?.subtasks?.length ? (
                task.subtasks.map((st: any) => (
                  <Link
                    key={String(st.id)}
                    to={`subtasks/${String(st.id)}`}
                    className="block w-full rounded-lg border bg-ui-bg-subtle p-4 hover:bg-ui-bg-base"
                  >
                    <div className="flex items-start justify-between gap-x-4">
                      <div className="min-w-0">
                        <Text size="small" weight="plus" className="truncate">
                          {String(st.title || st.id)}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {String(st.description || "")}
                        </Text>
                      </div>
                      <div className="shrink-0">
                        {st.status ? (
                          <Badge
                            size="2xsmall"
                            color={getStatusBadgeColor(String(st.status))}
                          >
                            {String(st.status)}
                          </Badge>
                        ) : (
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            -
                          </Text>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <Text size="small" className="text-ui-fg-subtle">
                  No subtasks
                </Text>
              )}
            </div>
          </div>
        </Container>

        

        {task && (
          <div className="xl:hidden">
            <JsonViewSection data={task as any} />
          </div>
        )}
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {task && <TaskActionsSection task={task} isPending={isPending} />}
        <ActivitiesSection title="Progress" items={activitySummary} />
        {task && (
          <div className="hidden xl:block">
            <JsonViewSection data={task as any} />
          </div>
        )}
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
