import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Heading, Text } from "@medusajs/ui";
import { Spinner } from "@medusajs/icons";
import { useInventoryOrderTask } from "../../../../../../hooks/api/inventory-order-tasks";
import { RouteDrawer } from "../../../../../../components/modal/route-drawer/route-drawer";
import { EditInventoryOrderTaskForm } from "../../../../../../components/edits/edit-inventory-order-task";

export default function EditInventoryOrderTaskPage() {
  const { id, taskId } = useParams();
  const { t } = useTranslation();
  const { task, isLoading, error } = useInventoryOrderTask(id!, taskId!);

  if (isLoading) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <div className="flex items-center gap-x-2">
            <Spinner className="animate-spin" />
            <Heading level="h2">{t("tasks.edit.loading", "Loading task...")}</Heading>
          </div>
        </RouteDrawer.Header>
        <div className="flex items-center justify-center py-16">
          <Text className="text-ui-fg-subtle">{t("tasks.edit.loadingDescription", "Please wait while we load the task details...")}</Text>
        </div>
      </RouteDrawer>
    );
  }

  if (error || !task) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading level="h2">{t("tasks.edit.error", "Error")}</Heading>
        </RouteDrawer.Header>
        <div className="flex items-center justify-center py-16">
          <Text className="text-ui-fg-subtle">
            {error?.message || t("tasks.edit.notFound", "Task not found")}
          </Text>
        </div>
      </RouteDrawer>
    );
  }

  const ready = !!task;

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{'Edit task'}</Heading>
      </RouteDrawer.Header>
      {ready && <EditInventoryOrderTaskForm task={task} inventoryOrderId={id!} />}
    </RouteDrawer>
  );
}
