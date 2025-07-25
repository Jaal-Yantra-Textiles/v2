import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@medusajs/ui";
import { AdminEmailTemplate } from "../api/email-templates";

const columnHelper = createColumnHelper<AdminEmailTemplate>();

export const useEmailTemplatesTableColumns = () => {
  return [
    columnHelper.accessor("name", {
      header: "Name",
      cell: ({ getValue }) => getValue() || "-",
    }),
    columnHelper.accessor("description", {
      header: "Description",
      cell: ({ getValue }) => getValue() || "-",
    }),
  ];
};
