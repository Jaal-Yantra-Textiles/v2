import { createDataTableColumnHelper } from "@medusajs/ui";
import { AdminAgreement } from "../api/agreement";

const columnHelper = createDataTableColumnHelper<AdminAgreement>();

export const useAgreementsTableColumns = () => {
  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: ({ getValue }) => getValue() || "-",
    }),
    // columnHelper.accessor("content", {
    //   header: "Content",
    //   cell: ({ getValue }) => getValue() || "-",
    // }),
  ];
};
