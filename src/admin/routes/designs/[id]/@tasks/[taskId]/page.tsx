import { useParams } from "react-router-dom";
import { useDesignTask } from "../../../../../hooks/api/design-tasks";
import { Heading, Container, Text } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { EditTaskForm } from "../../../../../components/designs/design-task-edit-section";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";

export default function TaskEditPage() {
  const { id, taskId } = useParams();
  const { t } = useTranslation();
  const { task, isLoading, error } = useDesignTask(id!, taskId!);

  const ready = !!task;

  if (isLoading) {
    return (
      <RouteDrawer>
        <Container className="p-0">
          <div className="px-6 py-4 border-b">
            <Heading level="h2">{t("tasks.edit.loading", "Loading task...")}</Heading>
          </div>
          <div className="p-6">
            <Text className="text-ui-fg-subtle">{t("tasks.edit.loadingDescription", "Please wait while we load the task details...")}</Text>
          </div>
        </Container>
      </RouteDrawer>
    );
  }

  if (error || !task) {
    return (
      <RouteDrawer>
        <Container className="p-0">
          <div className="px-6 py-4 border-b">
            <Heading level="h2">{t("tasks.edit.error", "Error")}</Heading>
          </div>
          <div className="p-6">
            <Text className="text-ui-fg-subtle">
              {error?.message || t("tasks.edit.notFound", "Task not found")}
            </Text>
          </div>
        </Container>
      </RouteDrawer>
    );
  }

  return (
     <RouteDrawer>
          <RouteDrawer.Header>
            <Heading>{'Edit task'}</Heading>
          </RouteDrawer.Header>
            {ready && <EditTaskForm task={task} designId={id!} />}
        </RouteDrawer>
  );
}
