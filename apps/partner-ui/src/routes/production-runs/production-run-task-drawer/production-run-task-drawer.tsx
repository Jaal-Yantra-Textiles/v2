import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../components/modals"
import { SectionRow } from "../../../components/common/section"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import { usePartnerAssignedTask } from "../../../hooks/api/partner-assigned-tasks"

export const ProductionRunTaskDrawer = () => {
  const { task_id } = useParams()

  const { task, isPending, isError, error } = usePartnerAssignedTask(task_id || "", {
    enabled: !!task_id,
  })

  const subtasks = useMemo(() => {
    return (task?.subtasks || []) as any[]
  }, [task?.subtasks])

  if (!task_id) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <RouteDrawer.Title asChild>
            <Heading>Task</Heading>
          </RouteDrawer.Title>
        </RouteDrawer.Header>
        <RouteDrawer.Body>
          <Container className="p-6">
            <Text size="small" className="text-ui-fg-subtle">
              Missing task id
            </Text>
          </Container>
        </RouteDrawer.Body>
      </RouteDrawer>
    )
  }

  if (isError) {
    throw error
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <RouteDrawer.Title asChild>
          <Heading>{task?.title || "Task"}</Heading>
        </RouteDrawer.Title>
        <RouteDrawer.Description className="sr-only">Task details</RouteDrawer.Description>
      </RouteDrawer.Header>

      <RouteDrawer.Body className="overflow-auto">
        <div className="flex flex-col gap-y-3 p-4">
          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-x-2">
                <Text size="small" className="text-ui-fg-subtle">
                  Status
                </Text>
                {task?.status ? (
                  <Badge size="2xsmall" color={getStatusBadgeColor(String(task.status))}>
                    {String(task.status)}
                  </Badge>
                ) : (
                  <Text size="small" className="text-ui-fg-subtle">-</Text>
                )}
              </div>
              {isPending && (
                <Text size="small" className="text-ui-fg-subtle">
                  Loading...
                </Text>
              )}
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
                  <Badge size="2xsmall" color={getStatusBadgeColor(String(task.status))}>
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
              {subtasks.length ? (
                <div className="flex flex-col gap-y-2">
                  {subtasks.map((st: any) => (
                    <div
                      key={String(st.id)}
                      className="flex items-start justify-between gap-x-4 rounded-lg border bg-ui-bg-subtle p-4"
                    >
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
                          <Text size="xsmall" className="text-ui-fg-subtle">-</Text>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Text size="small" className="text-ui-fg-subtle">
                  No subtasks
                </Text>
              )}
            </div>
          </Container>
        </div>
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}
