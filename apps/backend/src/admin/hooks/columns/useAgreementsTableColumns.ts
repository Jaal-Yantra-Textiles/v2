import { createColumnHelper } from "@tanstack/react-table";
import { AdminAgreement } from "../api/agreement";

const columnHelper = createColumnHelper<AdminAgreement>();

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
