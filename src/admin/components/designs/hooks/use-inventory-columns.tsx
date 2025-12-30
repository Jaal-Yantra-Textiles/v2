import { Text, createDataTableColumnHelper, Checkbox } from "@medusajs/ui";
import { InventoryItem } from "../../../hooks/api/raw-materials";
import { Thumbnail } from "../../../components/common/thumbnail";

const columnHelper = createDataTableColumnHelper<InventoryItem>();

interface SelectionProps {
  selectedRows: Record<string, unknown>;
  handleSelectAll: (checked: boolean) => void;
  handleRowSelect: (row: InventoryItem) => void;
  filteredItems: InventoryItem[];
  linkedItemIds: Set<string>;
}

export const useInventoryColumns = (selectionProps?: SelectionProps) => {

  return [
    selectionProps ? columnHelper.display({
      id: "select",
      header: () => (
        <div className="flex justify-center">
          {(() => {
            const selectableCount = selectionProps.filteredItems.filter((item) => {
              const rowId = item.inventory_item_id || item.id
              return !selectionProps.linkedItemIds.has(rowId)
            }).length
            const selectedCount = Object.keys(selectionProps.selectedRows).length
            const checked =
              selectableCount > 0 && selectedCount > 0 && selectedCount === selectableCount
            const indeterminate =
              selectableCount > 0 && selectedCount > 0 && selectedCount < selectableCount

            return (
              <Checkbox
                checked={indeterminate ? "indeterminate" : checked}
                disabled={!selectableCount}
                onCheckedChange={(checked) => selectionProps.handleSelectAll(checked as boolean)}
              />
            )
          })()}
        </div>
      ),
      cell: ({ row }) => {
        const rowId = row.id as string
        const isLinked = selectionProps.linkedItemIds.has(rowId)

        return (
          <div className="flex justify-center">
            <Checkbox
              checked={isLinked ? true : !!selectionProps.selectedRows[rowId]}
              disabled={isLinked}
              onCheckedChange={() => selectionProps.handleRowSelect(row.original)}
            />
          </div>
        );
      },
    }) : columnHelper.display({
      id: "select",
      header: () => <div className="flex justify-center"><Checkbox /></div>,
      cell: () => <div className="flex justify-center"><Checkbox /></div>,
    }),

    columnHelper.accessor((row) => row.inventory_item?.title || row.title, {
      id: "title",
      header: "Inventory",
      cell: ({ row }) => {
        const title = row.original.inventory_item?.title || row.original.title || "Untitled";
        
        return (
          <div className="flex items-center gap-x-3">
            <Thumbnail 
              src={row.original.thumbnail} 
              alt={title} 
              size="small"
            />
            <Text size="small" leading="compact">
              {title}
            </Text>
          </div>
        );
      },
      enableSorting: true,
      sortLabel: "Inventory",
    }),
    columnHelper.accessor((row) => row.inventory_item?.sku || row.sku, {
      id: "sku",
      header: "SKU",
      cell: ({ row }) => {
        const sku = row.original.inventory_item?.sku || row.original.sku || "-";
        
        return (
          <Text size="small" leading="compact">
            {sku}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "SKU",
    }),
    columnHelper.accessor((row) => row.raw_materials?.composition, {
      id: "composition",
      header: "Composition",
      cell: ({ row }) => {
        const composition = row.original.raw_materials?.composition || "-";
        
        return (
          <Text size="small" leading="compact">
            {composition}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Composition",
    }),
    columnHelper.accessor((row) => row.raw_materials?.name, {
      id: "name",
      header: "Material Name",
      cell: ({ row }) => {
        const name = row.original.raw_materials?.name || "-";
        
        return (
          <Text size="small" leading="compact">
            {name}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Material Name",
    }),
    columnHelper.accessor((row) => row.raw_materials?.material_type?.category, {
      id: "category",
      header: "Category",
      cell: ({ row }) => {
        const category = row.original.raw_materials?.material_type?.category || "-";
        
        return (
          <Text size="small" leading="compact">
            {category}
          </Text>
        );
      },
      enableSorting: true,
      sortLabel: "Category",
    }),
  ];
};
