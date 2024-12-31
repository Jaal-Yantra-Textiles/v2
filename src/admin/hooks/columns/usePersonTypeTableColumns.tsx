import { AdminPersonType } from "@medusajs/framework/types";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";

const columnHelper = createColumnHelper<AdminPersonType>();

export const usePersonTypeTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Type",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("description", {
        header: "Description",
        cell: ({ getValue }) =>
          getValue() ||
          ":) No description, sometimes it take courage to do that.",
      }),
    ],
    [],
  );
};
