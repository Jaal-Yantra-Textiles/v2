import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { ActivitiesSection } from "../../../components/common/activities-section"
import { SectionRow } from "../../../components/common/section"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  usePartnerAssignedTasks,
} from "../../../hooks/api/partner-assigned-tasks"
import { TaskActionsSection } from "./components/task-actions-section"

export const TaskDetail = () => {
  const { id } = useParams()

  const { tasks, isPending, isError, error } = usePartnerAssignedTasks()

  const task = useMemo(() => tasks.find((t) => t.id === id), [tasks, id])

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

  const activities = useMemo(() => {
    return [
      {
        id: "created",
        title: "created",
        status: task?.created_at ? "Completed" : "-",
        timestamp: task?.created_at,
      },
      {
        id: "updated",
        title: "updated",
        status: task?.updated_at ? "Completed" : "-",
        timestamp: task?.updated_at,
      },
    ]
  }, [task])

  return (
    <TwoColumnPage
      widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}
      hasOutlet
    >
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
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
                  <div key={String(st.id)} className="rounded-lg border p-4">
                    <Text size="small" weight="plus">
                      {String(st.title || st.id)}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Status: {String(st.status || "-")}
                    </Text>
                  </div>
                ))
              ) : (
                <Text size="small" className="text-ui-fg-subtle">
                  No subtasks
                </Text>
              )}
            </div>
          </div>
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {task && <TaskActionsSection task={task} isPending={isPending} />}
        <ActivitiesSection title="Activities" items={activities} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
