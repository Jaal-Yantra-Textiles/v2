import { Plus, Eye } from "@medusajs/icons";
import { Container, Heading, Skeleton, Text } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
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

export const InventoryOrderTasksSection = ({ inventoryOrder }: InventoryOrderTasksSectionProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);

  const tasks: InventoryOrderTask[] = (inventoryOrder.tasks || []) as any;
  const isLoading = !inventoryOrder.tasks;

  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "completed").length, [tasks]);
  const totalTasks = tasks.length;
  const percentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">{t("Activities")}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          {/* progress circle */}
          <div className="relative w-9 h-9 flex items-center justify-center">
            <svg className="absolute w-full h-full" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              {totalTasks > 0 && (
                <circle
                  cx="18" cy="18"
                  r="16"
                  fill="none"
                  stroke="#4f46e5"
                  strokeWidth="3"
                  strokeDasharray={`${percentage} 100`}
                  strokeLinecap="round"
                  transform="rotate(-90 18 18)"
                />
              )}
            </svg>
            <Text className="text-[10px] font-medium z-10">
              {completedTasks}/{totalTasks}
            </Text>
          </div>

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
      {isLoading ? (
        <Skeleton className="h-6 w-full" />
      ) : (
        <div className="flow-root py-1 px-1 pb-2 ">
          {tasks.length === 0 ? (
            <div className="w-full py-6 flex justify-center">
              <Text className="text-ui-fg-subtle">{t("No tasks found")}</Text>
            </div>
          ) : (
            <ul role="list" className="-mb-8">
              {tasks
                .slice(0, isExpanded ? tasks.length : 5)
                .map((task, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  const link = `/inventory/orders/${inventoryOrder.id}/tasks/${task.id}`;
                  return (
                    <li key={task.id}>
                      <div className="relative pb-8">
                        {!isLast && (
                          <span className="absolute top-4 left-4 -ml-px h-full border-l border-dashed border-ui-border-muted" aria-hidden="true" />
                        )}
                        <div className="relative flex space-x-3 pl-2">
                          <div>
                            <span className="flex size-5 items-center justify-center rounded-full bg-ui-bg-component ring-8 ring-white shadow-elevation-card-rest">
                              {/* dot */}
                              <span className="size-2 rounded-full bg-ui-fg-muted" />
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-1 space-x-4 pt-1.5 cursor-pointer" onClick={() => navigate(link)}>
                            <div>
                              <p className="text-sm text-ui-fg-base font-medium truncate">
                                {task.title || `Activity ${task.id.substring(0, 6)}`}
                              </p>
                              {task.status && (
                                <p className="text-xs text-ui-fg-subtle capitalize mb-0.5">{task.status}</p>
                              )}
                              {task.created_at && (
                                <time dateTime={task.created_at} className="text-xs text-ui-fg-subtle">
                                  {new Date(task.created_at).toLocaleDateString()}
                                </time>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
          {tasks.length > 5 && (
            <button
              className="mt-1 text-ui-fg-muted hover:text-ui-fg-base txt-small"
              onClick={() => setIsExpanded((p) => !p)}
            >
              {isExpanded ? t("Show less") : t("Show more")}
            </button>
          )}
        </div>
      )}
    </Container>
  );
};
