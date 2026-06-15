import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../modals"
import { SectionRow } from "../../common/section"
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

      <RouteDrawer.Body className="overflow-auto p-0">
        {/* Flat, full-width layout (#342): the drawer is already a panel, so the
            details flow as full-bleed rows separated by dividers rather than
            being re-boxed inside nested Containers. */}
        <div className="flex flex-col divide-y divide-ui-border-base">
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
          <SectionRow title="Task ID" value={task?.id || "-"} />

          <div className="flex flex-col gap-y-1 px-6 py-4">
            <Text size="small" weight="plus" leading="compact">
              Description
            </Text>
            <Text size="small" className="text-ui-fg-subtle whitespace-pre-line">
              {task?.description || "-"}
            </Text>
          </div>

          <div className="flex flex-col px-6 py-4">
            <Text size="small" weight="plus" leading="compact" className="mb-2">
              Subtasks{subtasks.length ? ` (${subtasks.length})` : ""}
            </Text>
            {subtasks.length ? (
              <div className="flex flex-col divide-y divide-ui-border-base">
                {subtasks.map((st: any) => (
                  <div
                    key={String(st.id)}
                    className="flex items-start justify-between gap-x-4 py-3 first:pt-0"
                  >
                    <div className="min-w-0">
                      <Text size="small" weight="plus" className="truncate">
                        {String(st.title || st.id)}
                      </Text>
                      {st.description && (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {String(st.description)}
                        </Text>
                      )}
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
        </div>
      </RouteDrawer.Body>
    </RouteDrawer>
  )
}
