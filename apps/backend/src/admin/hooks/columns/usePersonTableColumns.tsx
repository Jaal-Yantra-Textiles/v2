
import { useMemo } from "react";
import { AdminPerson } from "../api/personandtype";
import { EllipseGreenSolid, EllipseSolid } from "@medusajs/icons";
import { createDataTableColumnHelper, Tooltip } from "@medusajs/ui";

const columnHelper = createDataTableColumnHelper<AdminPerson>();

export const usePersonTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("email", {
        header: "Email",
        cell: ({ getValue }) => getValue(),
        enableSorting: true,
        sortLabel: "Email",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("first_name", {
        header: "Name",
        cell: ({
          row: {
            original: { first_name, last_name },
          },
        }) => `${first_name} ${last_name}`,
        enableSorting: true,
        sortLabel: "Name",
        sortAscLabel: "A → Z",
        sortDescLabel: "Z → A",
      }),
      columnHelper.accessor("date_of_birth", {
        header: "Date of Birth",
        cell: ({ getValue }) => getValue() || "N/A",
        enableSorting: true,
        sortLabel: "Date of birth",
        sortAscLabel: "Oldest first",
        sortDescLabel: "Newest first",
      }),
      // Status indicator column for deleted persons
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: ({
          row: {
            original: { deleted_at },
          },
        }) => {
          if (deleted_at) {
            return (
              <div className="flex items-center">
                <Tooltip content="Deleted person">
                  <div>
                    <EllipseSolid className="text-ui-fg-error h-4 w-4" />
                  </div>
                </Tooltip>
              </div>
            );
          }
          return (
            <div className="flex items-center">
              <Tooltip content="Active person">
                <div>
                  <EllipseGreenSolid className="text-ui-fg-interactive-success h-4 w-4" />
                </div>
              </Tooltip>
            </div>
          );
        },
      }),
    ],
    [],
  );
};
