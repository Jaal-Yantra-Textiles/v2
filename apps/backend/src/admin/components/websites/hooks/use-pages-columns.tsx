import { Text, StatusBadge, createDataTableColumnHelper, DataTableAction } from "@medusajs/ui";
import { AdminPage } from "../../../hooks/api/pages";
import { PencilSquare, Trash } from "@medusajs/icons";
import { useCallback } from "react";

const columnHelper = createDataTableColumnHelper<AdminPage>();

const pageStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "published":
      return "green";
    case "draft":
      return "orange";
    case "archived":
      return "red";
    default:
      return "grey";
  }
};

export const usePagesColumns = () => {
  const getActions = useCallback(
    (row: { original: AdminPage }) => {
      const mainActions: DataTableAction<AdminPage>[] = [
        {
          icon: <PencilSquare />,
          label: "Edit",
          onClick: () => {
            // TODO: Implement edit action
            
          },
        },
      ];

      const secondaryActions: DataTableAction<AdminPage>[] = [
        {
          icon: <Trash />,
          label: "Delete",
          onClick: () => {
            // TODO: Implement delete action
            console.log("Delete", row.original.id);
          },
        },
      ];

      return [mainActions, secondaryActions];
    },
    []
  );

  return [
    columnHelper.accessor("title", {
      header: "Title",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {row.original.title}
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {row.original.slug}
          </Text>
        </div>
      ),
      enableSorting: true,
      sortLabel: "Title",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue();
        return (
          <StatusBadge color={pageStatusColor(status)}>
            {status}
          </StatusBadge>
        );
      },
      enableSorting: true,
      sortLabel: "Status",
    }),
    columnHelper.accessor("page_type", {
      header: "Type",
      cell: ({ getValue }) => {
        const pageType = getValue();
        return (
          <Text size="small" leading="compact">
            {pageType}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Page Type",
    }),
    columnHelper.action({
      actions: (ctx) => getActions({ original: ctx.row.original }),
    }),
  ];
};
