import { createColumnHelper } from "@tanstack/react-table";
import { Notification } from "../api/notifications";

const columnHelper = createColumnHelper<Notification>();

export const useFailedNotificationsTableColumns = () => {
  return [
    columnHelper.accessor("created_at", {
      header: "Created",
      cell: ({ getValue }) => {
        const value = getValue();
        return value ? new Date(value).toLocaleString() : "-";
      },
    }),
    columnHelper.accessor("to", {
      header: "Recipient",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("template", {
      header: "Template",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("provider_id", {
      header: "Provider",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("external_id", {
      header: "External ID",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("data", {
      header: "Error",
      cell: ({ getValue }) => {
        const data = (getValue() || {}) as Record<string, any>;
        return data.error_message || data.message || "-";
      },
    }),
  ];
};
