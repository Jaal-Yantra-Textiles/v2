import { AdminTaskTemplate } from "../api/task-templates";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge } from "@medusajs/ui";

const columnHelper = createColumnHelper<AdminTaskTemplate>();

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "low":
      return "blue";
    case "medium":
      return "orange";
    case "high":
      return "red";
    default:
      return "grey";
  }
};

export const useTaskTemplatesTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("description", {
        header: "Description",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: ({ getValue }) => {
          const priority = getValue();
          return (
            <Badge color={getPriorityColor(priority)}>
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("category.name", {
        header: "Category",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.accessor("estimated_duration", {
        header: "Est. Duration (min)",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.display({
        id: "notifications",
        header: "Notifications",
        cell: ({ row }) => {
          const template = row.original;
          const notifications = [];
          if (template.eventable) notifications.push("Events");
          if (template.notifiable) notifications.push("Notifications");
          return notifications.join(", ") || "None";
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created At",
        cell: ({ getValue }) => {
          const date = getValue();
          if (!date) return "N/A";
          return new Date(date).toLocaleDateString();
        },
      }),
    ],
    [],
  );
};
