import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { EditProductionRunTaskForm } from "../../../../../components/production-runs/production-run-task-edit-form"
import { useProductionRunTask } from "../../../../../hooks/api/production-runs"

export default function ProductionRunTaskEditPage() {
  const { id, taskId } = useParams()
  const { t } = useTranslation()
  const { task, isLoading, error } = useProductionRunTask(id!, taskId!, {
    enabled: !!id && !!taskId,
  })

  if (isLoading) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Skeleton className="h-6 w-40" />
        </RouteDrawer.Header>
        <div className="flex flex-1 flex-col gap-y-6 overflow-y-auto px-6 py-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </RouteDrawer>
    )
  }

  if (error || !task) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>{t("tasks.edit.error", "Error")}</Heading>
        </RouteDrawer.Header>
        <div className="px-6 py-6">
          <Text className="text-ui-fg-subtle">
            {error?.message || t("tasks.edit.notFound", "Task not found")}
          </Text>
        </div>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <Heading>{task.title || task.id}</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("tasks.edit.subtitle", "Edit task details")}
          </Text>
        </div>
      </RouteDrawer.Header>
      <EditProductionRunTaskForm task={task} runId={id!} />
    </RouteDrawer>
  )
}
