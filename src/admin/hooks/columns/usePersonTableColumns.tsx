
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminPerson } from "../api/personandtype";
import { EllipseGreenSolid, EllipseSolid } from "@medusajs/icons";
import { Tooltip } from "@medusajs/ui";

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
