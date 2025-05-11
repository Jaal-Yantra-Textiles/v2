import { Plus, TriangleRightMini, Eye } from "@medusajs/icons";
import { Container, Heading, Skeleton, Text } from "@medusajs/ui";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { AdminDesign } from "../../hooks/api/designs";
import { AdminDesignTask } from "../../hooks/api/design-tasks";
import { ActionMenu } from "../common/action-menu";

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
  subtaskCount?: number;
  parent_task_id?: string;
  isSubtask?: boolean;
}

interface DesignTasksSectionProps {
  design: AdminDesign;
}

export const DesignTasksSection = ({ design }: DesignTasksSectionProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const isLoading = !design?.tasks;


  // Function to collect tasks with subtask information
  const collectTasks = (tasks: AdminDesignTask[] = [], isSubtask: boolean = false): TaskItem[] => {
    const collected: TaskItem[] = [];

    tasks.forEach((task: AdminDesignTask) => {
      // Add the main task with subtask count if it has subtasks
      collected.push({
        id: task.id,
        title: task.title || `Task ${task.id}`,
        description: task.description,
        start_date: task.start_date ? new Date(task.start_date).toISOString() : undefined,
        end_date: null, // API structure doesn't have end_date yet
        status: task.status,
        priority: task.priority,
        created_at: new Date(task.created_at).toISOString(),
        updated_at: new Date(task.updated_at).toISOString(),
        subtaskCount: task.subtasks?.length || 0,
        parent_task_id: task.parent_task_id,
        isSubtask: isSubtask,
      });
    });

    return collected;
  };

  // Function to get only top-level tasks
  const getTopLevelTasks = (tasks: AdminDesignTask[] = []): TaskItem[] => {
    return collectTasks(tasks.filter(task => !task.parent_task_id));
  };

  // Transform design tasks into TaskItem objects, only showing top-level tasks
  const taskItems: TaskItem[] = isLoading ? [] : getTopLevelTasks(design.tasks || []);

  // Get all tasks including subtasks for the completion counter
  const allTasks: TaskItem[] = isLoading ? [] : collectTasks(design.tasks || [], false);
  const allSubtasks: TaskItem[] = isLoading ? [] : collectTasks(
    design.tasks?.flatMap(task => task.subtasks || []) || [],
    true
  );

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

  // Combine all tasks for the completion counter
  const allTasksWithSubtasks = [...allTasks, ...allSubtasks];

  // Calculate completed tasks ratio
  const completedTasks = allTasksWithSubtasks.filter(task => task.status === "completed").length;
  const totalTasks = allTasksWithSubtasks.length;

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
            <div className="relative w-10 h-10 flex items-center justify-center z-0">
              {/* Background circle */}
              <svg className="absolute w-full h-full z-0" viewBox="0 0 36 36">
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
                    onClick: () => navigate(`/designs/${design.id}/tasks/templates`),
                  },
                  {
                    label: t("View Task Canvas"),
                    icon: <Eye />,
                    to: 'view-canvas'
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
        <div className="txt-small flex flex-col gap-2 py-1 px-1 pb-2">
          {!taskItems.length ? (
            <div className="w-full py-6 flex justify-center">
              <Text className="text-ui-fg-subtle">{t("No tasks found")}</Text>
            </div>
          ) : taskItems.length <= 5 ? (
            // Show all tasks if 5 or fewer
            taskItems.map((task) => {
              const link = `/designs/${design.id}/tasks/${task.id}`;
              return renderTaskItem(task, link);
            })
          ) : (
            // Use ProgressAccordion for more than 5 tasks
            <div className="relative">
              {/* Show first 2 tasks always */}
              <div className="flex flex-col gap-y-2 w-full">
                {taskItems.slice(0, 2).map((task) => {
                  const link = `/designs/${design.id}/tasks/${task.id}`;
                  return renderTaskItem(task, link);
                })}
              </div>
              
              {/* Collapsible section for additional tasks */}
              <div className="w-full mt-2">
                {/* Collapsed view - clickable header */}
                {!isExpanded ? (
                  <div 
                    className="px-4 py-3 bg-ui-bg-subtle hover:bg-ui-bg-base-hover rounded-md shadow-elevation-card-rest relative cursor-pointer"
                    onClick={() => setIsExpanded(true)}
                    role="button"
                  >
                    <div className="flex items-center justify-between w-full">
                      <Text size="small" className="text-ui-fg-subtle font-medium">
                        {taskItems.length - 2} more tasks
                      </Text>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col w-full">
                    {/* Expanded view - header */}
                    <div className="px-4 py-3 bg-ui-bg-subtle rounded-md shadow-elevation-card-rest relative mb-2">
                      <div className="flex items-center justify-between w-full">
                        <Text size="small" className="text-ui-fg-subtle font-medium">
                          {taskItems.length - 2} more tasks
                        </Text>
                      </div>
                    </div>
                    
                    {/* Task list */}
                    <div className="flex flex-col gap-y-2 pb-2 w-full px-1.5">
                      {taskItems.slice(2).map((task) => {
                        const link = `/designs/${design.id}/tasks/${task.id}`;
                        return renderTaskItem(task, link);
                      })}
                      
                      {/* Close button */}
                      <div 
                        className="flex items-center justify-center py-2 mt-2 bg-ui-bg-subtle hover:bg-ui-bg-base-hover rounded-md cursor-pointer shadow-sm"
                        onClick={() => setIsExpanded(false)}
                        role="button"
                      >
                        <Text size="small" className="text-ui-fg-subtle font-medium">
                          Show less
                        </Text>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Container>
  );

  // Helper function to render a task item
  function renderTaskItem(task: TaskItem, link: string) {
    const Inner = (
      <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-3 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-ui-fg-base font-medium">
                  {task.title}
                </span>
                {task.subtaskCount && task.subtaskCount > 0 && (
                  <div className="relative group">
                    <div className="bg-ui-tag-blue-bg text-ui-tag-blue text-xs font-medium rounded-full px-2 py-0.5 cursor-help">
                      {task.subtaskCount}
                    </div>
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-ui-bg-base text-ui-fg-base text-xs rounded shadow-elevation-flyout w-48 hidden group-hover:block z-10">
                      <p className="font-medium mb-1">{t("Subtasks")}</p>
                      <p>{t("This task has {{count}} subtasks", { count: task.subtaskCount })}</p>
                      <p className="mt-1 text-ui-fg-subtle">{t("View in canvas to see relationships")}</p>
                    </div>
                  </div>
                )}
              </div>
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
  }
};
