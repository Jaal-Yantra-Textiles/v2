import { useParams } from "react-router-dom";
import { useDesignTask } from "../../../../../hooks/api/design-tasks";
import { Heading, Text, Skeleton } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { EditTaskForm } from "../../../../../components/designs/design-task-edit-section";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";

export default function TaskEditPage() {
  const { id, taskId } = useParams();
  const { t } = useTranslation();
  const { task, isLoading, error } = useDesignTask(id!, taskId!);

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
    );
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
    );
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <Heading>{task.title}</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("tasks.edit.subtitle", "Edit task details")}
          </Text>
        </div>
      </RouteDrawer.Header>
      <EditTaskForm task={task} designId={id!} />
    </RouteDrawer>
  );
}
