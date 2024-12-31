import { AdminPerson } from "@medusajs/framework/types";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";

const columnHelper = createColumnHelper<AdminPerson>();

export const usePersonTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("email", {
        header: "Email",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.display({
        id: "name",
        header: "Name",
        cell: ({
          row: {
            original: { first_name, last_name },
          },
        }) => `${first_name} ${last_name}`,
      }),
      columnHelper.accessor("date_of_birth", {
        header: "Date of Birth",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.accessor("created_at", {
        header: "Created At",
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
    ],
    [],
  );
};
