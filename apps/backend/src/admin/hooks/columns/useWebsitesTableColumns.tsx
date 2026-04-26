import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { AdminWebsite } from "../api/websites";
import { Badge } from "@medusajs/ui";

const columnHelper = createColumnHelper<AdminWebsite>();

export const useWebsitesTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("domain", {
        header: "Domain",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue();
          let color: "green" | "red" | "blue" | "orange" = "blue";
          
          switch (status) {
            case "Active":
              color = "green";
              break;
            case "Inactive":
              color = "red";
              break;
            case "Maintenance":
              color = "orange";
              break;
            case "Development":
              color = "blue";
              break;
          }
          
          return status ? (
            <Badge color={color}>{status}</Badge>
          ) : (
            "N/A"
          );
        },
      }),
      columnHelper.accessor("primary_language", {
        header: "Primary Language",
        cell: ({ getValue }) => getValue() || "N/A",
      }),
      columnHelper.accessor("created_at", {
        header: "Created At",
        cell: ({ getValue }) => 
          getValue() ? new Date(getValue()).toLocaleDateString() : "N/A",
      }),
    ],
    [],
  );
};
