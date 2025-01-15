import { AdminDesign } from "../../hooks/api/designs";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge } from "@medusajs/ui";

const columnHelper = createColumnHelper<AdminDesign>();

const getStatusColor = (status: string) => {
  switch (status) {
    case "Conceptual":
      return "blue";
    case "In_Development":
      return "orange";
    case "Technical_Review":
      return "purple";
    case "Sample_Production":
      return "orange";
    case "Revision":
      return "red";
    case "Approved":
      return "green";
    case "Rejected":
      return "red";
    case "On_Hold":
      return "grey";
    default:
      return "grey";
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "Low":
      return "blue";
    case "Medium":
      return "orange";
    case "High":
      return "red";
    case "Urgent":
      return "red";
    default:
      return "grey";
  }
};

export const useDesignsTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("design_type", {
        header: "Type",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue();
          if (!status) return "N/A";
          return (
            <Badge color={getStatusColor(status)}>
              {status.replace(/_/g, " ")}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: ({ getValue }) => {
          const priority = getValue();
          if (!priority) return "N/A";
          return (
            <Badge color={getPriorityColor(priority)}>
              {priority}
            </Badge>
          );
        },
      }),
      columnHelper.accessor("tags", {
        header: "Tags",
        cell: ({ getValue }) => {
          const tags = getValue();
          if (!tags?.length) return "N/A";
          return tags.join(", ");
        },
      }),
      columnHelper.accessor("target_completion_date", {
        header: "Target Date",
        cell: ({ getValue }) => {
          const date = getValue();
          if (!date) return "N/A";
          return new Date(date).toLocaleDateString();
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
