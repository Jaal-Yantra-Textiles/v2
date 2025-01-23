
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminPersonType } from "../api/personandtype";

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
