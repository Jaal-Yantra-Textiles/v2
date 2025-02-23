import { Text, StatusBadge, createDataTableColumnHelper, DataTableAction, Checkbox, Tooltip } from "@medusajs/ui";
import { PencilSquare, Trash } from "@medusajs/icons";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { InventoryItem } from "../../../hooks/api/raw-materials";

const columnHelper = createDataTableColumnHelper<InventoryItem>();

const inventoryStatusColor = (status: string) => {
  switch (status) {
    case "Active":
      return "green";
    case "Discontinued":
      return "red";
    case "Under_Review":
    case "Development":
      return "orange";
    default:
      return "grey";
  }
};

interface SelectionProps {
  selectedRows: Record<string, boolean>;
  handleSelectAll: (checked: boolean) => void;
  handleRowSelect: (id: string) => void;
  filteredItems: InventoryItem[];
  linkedItemIds: Set<string>;
}

export const useInventoryColumns = (selectionProps?: SelectionProps) => {
  const navigate = useNavigate();
  const getActions = useCallback(
    (row: { original: InventoryItem }) => {
      const mainActions: DataTableAction<InventoryItem>[] = [
        {
          icon: <PencilSquare />,
          label: "Edit",
          onClick: () => {
            navigate(`/inventory/${row.original.id}/raw-materials/${row.original.raw_materials?.id}/edit`);
          },
        },
      ];

      const secondaryActions: DataTableAction<InventoryItem>[] = [
        {
          icon: <Trash />,
          label: "Delete",
          onClick: () => {
            // TODO: Implement delete action
            console.log("Delete inventory item", row.original.id);
          },
        },
      ];

      return [mainActions, secondaryActions];
    },
    [navigate]
  );

  return [
    selectionProps ? columnHelper.display({
      id: "select",
      header: () => (
        <div className="flex justify-center">
          <Checkbox
            checked={selectionProps.filteredItems.length > 0 && Object.keys(selectionProps.selectedRows).length === selectionProps.filteredItems.length}
            onCheckedChange={(checked) => selectionProps.handleSelectAll(checked as boolean)}
          />
        </div>
      ),
      cell: ({ row }) => {
        const isLinked = selectionProps.linkedItemIds.has(row.id);
        const checkbox = (
          <Checkbox
            checked={!!selectionProps.selectedRows[row.id]}
            onCheckedChange={() => selectionProps.handleRowSelect(row.id)}
            disabled={isLinked}
          />
        );

        if (isLinked) {
          return (
            <div className="flex justify-center">
              <Tooltip content="Already linked to this design">
                <div>{checkbox}</div>
              </Tooltip>
            </div>
          );
        }

        return (
          <div className="flex justify-center">
            {checkbox}
          </div>
        );
      },
    }) : columnHelper.display({
      id: "select",
      header: () => <div className="flex justify-center"><Checkbox /></div>,
      cell: () => <div className="flex justify-center"><Checkbox /></div>,
    }),
    columnHelper.accessor((row) => row.id, {
      id: "id",
      header: "ID",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {getValue()}
        </Text>
      ),
      enableSorting: true,
      sortLabel: "ID",
    }),
    columnHelper.accessor((row) => row.title, {
      id: "title",
      header: "Title",
      cell: ({ row }) => (
        <div className="flex items-center gap-x-3">
          {row.original.thumbnail && (
            <img 
              src={row.original.thumbnail} 
              alt={row.original.title} 
              className="w-8 h-8 object-cover rounded"
            />
          )}
          <Text size="small" leading="compact">
            {row.original.title}
          </Text>
        </div>
      ),
      enableSorting: true,
      sortLabel: "Title",
    }),
    columnHelper.accessor((row) => row.raw_materials?.name ?? row.title, {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {row.original.raw_materials?.name ?? row.original.title}
          </Text>
          {row.original.raw_materials && (
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {row.original.raw_materials.composition}
            </Text>
          )}
        </div>
      ),
      enableSorting: true,
      sortLabel: "Name",
    }),
    columnHelper.accessor((row) => row.raw_materials?.material_type?.category ?? "N/A", {
      id: "category",
      header: "Category",
      cell: ({ getValue }) => {
        const category = getValue();
        return (
          <Text size="small" leading="compact" className={category === "N/A" ? "text-ui-fg-subtle" : ""}>
            {category}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Category",
    }),
    columnHelper.accessor((row) => row.raw_materials?.unit_of_measure ?? "N/A", {
      id: "unit",
      header: "Unit of Measure",
      cell: ({ getValue }) => {
        const unit = getValue();
        return (
          <Text size="small" leading="compact" className={unit === "N/A" ? "text-ui-fg-subtle" : ""}>
            {unit}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Unit",
    }),

    columnHelper.accessor((row) => row.raw_materials?.status ?? "N/A", {
      id: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue();
        return status !== "N/A" ? (
          <StatusBadge color={inventoryStatusColor(status)}>
            {status.replace("_", " ")}
          </StatusBadge>
        ) : (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Not Available
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Status",
    }),
    columnHelper.action({
      actions: (ctx) => getActions({ original: ctx.row.original }),
    }),
  ];
};
