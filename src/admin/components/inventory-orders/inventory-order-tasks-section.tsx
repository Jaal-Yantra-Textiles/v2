import { Plus, Eye } from "@medusajs/icons";
import { Container, Heading, Text, Skeleton } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { formatDistanceToNow } from "date-fns";
import { ActionMenu } from "../common/action-menu";

interface InventoryOrderTask {
  id: string;
  title?: string;
  description?: string;
  status: string;
  priority?: string;
  created_at: string;
  updated_at: string;
}

interface InventoryOrderTasksSectionProps {
  inventoryOrder: AdminInventoryOrder;
}

interface TaskTimelineProps {
  tasks: InventoryOrderTask[];
  inventoryOrderId: string;
}

const TaskTimeline = ({ tasks, inventoryOrderId }: TaskTimelineProps) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-y-0.5">
      {tasks.map((task, idx, arr) => {
        const isLast = idx === arr.length - 1;
        const link = `/inventory/orders/${inventoryOrderId}/tasks/${task.id}`;
        return (
          <div key={task.id} className="grid grid-cols-[20px_1fr] items-start gap-2">
            <div className="flex size-full flex-col items-center gap-y-0.5">
              <div className="flex size-5 items-center justify-center">
                <div className="bg-ui-bg-base shadow-borders-base flex size-2.5 items-center justify-center rounded-full">
                  <div className="bg-ui-tag-neutral-icon size-1.5 rounded-full" />
                </div>
              </div>
              {!isLast && <div className="bg-ui-border-base w-px flex-1" />}
            </div>
            <div className={`${!isLast ? 'pb-4' : ''} cursor-pointer`} onClick={() => navigate(link)}>
              <div className="flex items-center justify-between">
                <Text size="small" leading="compact" weight="plus">
                  {task.title || `Task ${task.id.substring(0, 6)}`}
                </Text>
                {task.created_at && (
                  <Text size="small" leading="compact" className="text-ui-fg-subtle text-right">
                    {formatDistanceToNow(new Date(task.created_at))}
                  </Text>
                )}
              </div>
              {task.status && (
                <Text size="small" className="text-ui-fg-subtle capitalize mt-1">
                  {task.status}
                </Text>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const InventoryOrderTasksSection = ({ inventoryOrder }: InventoryOrderTasksSectionProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);

  const tasks: InventoryOrderTask[] = (inventoryOrder.tasks || []) as any;
  const isLoading = !inventoryOrder.tasks;

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">{t("Activities")}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("Add From Template"),
                    icon: <Plus />,
                    onClick: () => navigate(`/inventory/orders/${inventoryOrder.id}/tasks/templates`),
                  },
                  {
                    label: t("View Task Canvas"),
                    icon: <Eye />,
                    to: "view-canvas",
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="px-6 py-4">
        {isLoading ? (
          <Skeleton className="h-6 w-full" />
        ) : (
          <div>
            {tasks.length === 0 ? (
              <div className="w-full py-6 flex justify-center">
                <Text className="text-ui-fg-subtle">{t("No tasks found")}</Text>
              </div>
            ) : (
              <TaskTimeline tasks={tasks} inventoryOrderId={inventoryOrder.id} />
            )}
            {tasks.length > 5 && (
              <button
                className="mt-4 text-ui-fg-muted hover:text-ui-fg-base txt-small"
                onClick={() => setIsExpanded((p) => !p)}
              >
                {isExpanded ? t("Show less") : t("Show more")}
              </button>
            )}
          </div>
        )}
      </div>
    </Container>
  );
};
