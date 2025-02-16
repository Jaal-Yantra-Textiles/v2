import { Text, StatusBadge, createDataTableColumnHelper, DataTableAction } from "@medusajs/ui";
import { AdminPage } from "../../../hooks/api/pages";
import { Pencil, Trash } from "lucide-react";
import { useCallback } from "react";

const columnHelper = createDataTableColumnHelper<AdminPage>();

const blogStatusColor = (status: string) => {
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

export const useBlogColumns = () => {
  const getActions = useCallback(
    (row: { original: AdminPage }) => {
      const mainActions: DataTableAction<AdminPage>[] = [
        {
          icon: <Pencil />,
          label: "Edit",
          onClick: () => {
            // TODO: Implement edit action
            console.log("Edit blog", row.original.id);
          },
        },
      ];

      const secondaryActions: DataTableAction<AdminPage>[] = [
        {
          icon: <Trash />,
          label: "Delete",
          onClick: () => {
            // TODO: Implement delete action
            console.log("Delete blog", row.original.id);
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
          <StatusBadge color={blogStatusColor(status)}>
            {status}
          </StatusBadge>
        );
      },
      enableSorting: true,
      sortLabel: "Status",
    }),
    columnHelper.accessor("published_at", {
      header: "Published Date",
      cell: ({ getValue }) => {
        const date = getValue();
        return (
          <Text size="small" leading="compact">
            {date ? new Date(date).toLocaleDateString() : "Not published"}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Published Date",
    }),
    columnHelper.action({
      actions: (ctx) => getActions({ original: ctx.row.original }),
    }),
  ];
};
