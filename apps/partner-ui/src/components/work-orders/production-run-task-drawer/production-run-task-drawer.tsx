import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../modals"
import { SectionRow } from "../../common/section"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import { usePartnerAssignedTask } from "../../../hooks/api/partner-assigned-tasks"
import { GoodsTransferSection } from "../goods-transfer-section"

export const ProductionRunTaskDrawer = () => {
  const { task_id } = useParams()

  const { task, isPending, isError, error } = usePartnerAssignedTask(task_id || "", {
    enabled: !!task_id,
  })

  const subtasks = useMemo(() => {
    return (task?.subtasks || []) as any[]
  }, [task?.subtasks])

  /**
   * A task template can carry an ACTION, not just a checklist line (#891). The
   * tasks module knows nothing about shipping — the binding lives in the
   * template's metadata, which `createTaskWithTemplates` merges onto every task
   * it creates, alongside the `production_run_id` the run dispatch adds. A task
   * whose template declared `create_goods_transfer` therefore arrives here
   * already knowing both what to do and which run to do it for, and renders the
   * movement form in place of a bare "mark done".
   *
   * Anything else renders as an ordinary task — an unknown action is not an
   * error, just a template this build doesn't have a form for.
   */
  const action = (task?.metadata as any)?.action
  const actionRunId = (task?.metadata as any)?.production_run_id

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

          {action === "create_goods_transfer" && actionRunId ? (
            <GoodsTransferSection
              runId={String(actionRunId)}
              // The task IS the instruction to move the goods — gating it on
              // run completion here would hide the very step the partner was
              // handed. Completion is enforced upstream, by when the step is
              // dispatched.
              isCompleted
            />
          ) : null}

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
