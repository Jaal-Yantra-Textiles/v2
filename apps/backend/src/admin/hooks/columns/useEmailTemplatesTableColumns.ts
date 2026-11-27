import { Badge, createDataTableColumnHelper } from "@medusajs/ui";
import { AdminEmailTemplate } from "../api/email-templates";

const columnHelper = createDataTableColumnHelper<AdminEmailTemplate>();

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
