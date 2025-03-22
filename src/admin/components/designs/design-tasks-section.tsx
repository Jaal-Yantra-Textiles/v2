import { Plus, TriangleRightMini } from "@medusajs/icons";
import { Container, Heading, Skeleton, Text } from "@medusajs/ui";
import { AdminDesign } from "../../hooks/api/designs";
import { Link, useNavigate } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";
import { useTranslation } from "react-i18next";
import { AdminDesignTask, useDesignTasks } from "../../hooks/api/design-tasks";

// Define the explicit task item interface
interface TaskItem {
  id: string;
  title: string;
  description?: string;
  start_date?: string;
  end_date?: string | null;
  status: string;
  priority?: string;
  created_at: string;
  updated_at: string;
}

interface DesignTasksSectionProps {
  design: AdminDesign;
}

export const DesignTasksSection = ({ design }: DesignTasksSectionProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { tasks, isLoading } = useDesignTasks(design.id);

  // Transform API response tasks into TaskItem objects
  const taskItems: TaskItem[] = tasks?.map((task: AdminDesignTask) => {
    return {
      id: task.id,
      title: task.title || `Task ${task.id}`,
      description: task.description,
      start_date: task.start_date ? new Date(task.start_date).toISOString() : undefined,
      end_date: null, // API structure doesn't have end_date yet
      status: task.status,
      priority: task.priority,
      created_at: new Date(task.created_at).toISOString(),
      updated_at: new Date(task.updated_at).toISOString(),
    };
  }) || [];

  const getStatusClass = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "in_progress":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "cancelled":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString();
  };

  // Calculate completed tasks ratio
  const completedTasks = taskItems.filter(task => task.status === "completed").length;
  const totalTasks = taskItems.length;
  
  // Calculate percentage for the circle fill
  const completionPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  
  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">{t("Tasks")}</Heading>
        </div>
        <div className="flex items-center gap-x-4">
          {/* Task Completion Indicator */}
          <div className="flex items-center mr-2">
            <div className="relative w-10 h-10 flex items-center justify-center">
              {/* Background circle */}
              <svg className="absolute w-full h-full" viewBox="0 0 36 36">
                <circle 
                  cx="18" 
                  cy="18" 
                  r="16" 
                  fill="none" 
                  stroke="#e5e7eb" 
                  strokeWidth="3" 
                />
                {/* Completion circle */}
                {totalTasks > 0 && (
                  <circle 
                    cx="18" 
                    cy="18" 
                    r="16" 
                    fill="none" 
                    stroke="#4f46e5" 
                    strokeWidth="3" 
                    strokeDasharray={`${completionPercentage} 100`}
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                  />
                )}
              </svg>
              {/* Text inside circle */}
              <Text className="text-xs font-medium z-10">
                {completedTasks}/{totalTasks}
              </Text>
            </div>
          </div>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: t("Add Task"),
                    icon: <Plus />,
                    onClick: () => navigate(`/designs/${design.id}/tasks/new`),
                  },
                  {
                    label: t("Add From Template"),
                    icon: <Plus />,
                    onClick: () => navigate(`/designs/${design.id}/tasks/template/new`),
                  },
                ],
              },
            ]}
          />
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-full" />
      ) : (
        <div className="txt-small flex flex-col gap-2 px-2 pb-2">
          {!taskItems.length ? (
            <div className="px-6 py-4 text-ui-fg-subtle">
              <Text>{t("No tasks found")}</Text>
            </div>
          ) : (
            taskItems.map((task) => {
              const link = `/designs/${design.id}/tasks/${task.id}`;
              
              const Inner = (
                <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 flex-col">
                      <div className="flex justify-between items-center">
                        <span className="text-ui-fg-base font-medium">
                          {task.title}
                        </span>
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${getStatusClass(task.status)}`}>
                          {task.status}
                        </span>
                      </div>
                      
                      {task.description && (
                        <span className="text-ui-fg-subtle text-sm mt-1 line-clamp-1">
                          {task.description}
                        </span>
                      )}
                      
                      <div className="flex gap-4 mt-2 text-xs text-ui-fg-subtle">
                        <div>
                          <span className="font-medium">Start:</span> {formatDate(task.start_date)}
                        </div>
                        <div>
                          <span className="font-medium">Created:</span> {formatDate(task.created_at)}
                        </div>
                        {task.priority && (
                          <div>
                            <span className="font-medium">Priority:</span> {task.priority}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="size-7 flex items-center justify-center">
                      <TriangleRightMini className="text-ui-fg-muted" />
                    </div>
                  </div>
                </div>
              );
              
              return (
                <Link
                  to={link}
                  key={task.id}
                  className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
                >
                  {Inner}
                </Link>
              );
            })
          )}
        </div>
      )}
    </Container>
  );
};
