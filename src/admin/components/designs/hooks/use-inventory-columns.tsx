import { Text, createDataTableColumnHelper, Checkbox } from "@medusajs/ui";
import { InventoryItem } from "../../../hooks/api/raw-materials";
import { Thumbnail } from "../../../components/common/thumbnail";

const columnHelper = createDataTableColumnHelper<InventoryItem>();

interface SelectionProps {
  selectedRows: Record<string, boolean>;
  handleSelectAll: (checked: boolean) => void;
  handleRowSelect: (id: string) => void;
  filteredItems: InventoryItem[];
  linkedItemIds: Set<string>;
}

export const useInventoryColumns = (selectionProps?: SelectionProps) => {

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
        return (
          <div className="flex justify-center">
            <Checkbox
              checked={!!selectionProps.selectedRows[row.id]}
              onCheckedChange={() => selectionProps.handleRowSelect(row.id)}
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
