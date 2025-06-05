import { Text, createDataTableColumnHelper, Checkbox, Tooltip } from "@medusajs/ui";
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
        const isLinked = selectionProps?.linkedItemIds?.has(row.original.inventory_item_id || row.original.id);
        const sku = row.original.inventory_item?.sku || row.original.sku || "-";
        
        const content = (
          <Text size="small" leading="compact" className={isLinked ? "text-ui-fg-subtle" : ""}>
            {sku}
          </Text>
        );
        
        if (isLinked) {
          return (
            <Tooltip content="This inventory item is already linked to this design">
              {content}
            </Tooltip>
          );
        }
        
        return content;
      },
      enableSorting: true,
      sortLabel: "SKU",
    }),
    columnHelper.accessor((row) => row.raw_materials?.composition, {
      id: "composition",
      header: "Composition",
      cell: ({ row }) => {
        const isLinked = selectionProps?.linkedItemIds?.has(row.original.inventory_item_id || row.original.id);
        const composition = row.original.raw_materials?.composition || "-";
        
        const content = (
          <Text size="small" leading="compact" className={isLinked ? "text-ui-fg-subtle" : ""}>
            {composition}
          </Text>
        );
        
        if (isLinked) {
          return (
            <Tooltip content="This inventory item is already linked to this design">
              {content}
            </Tooltip>
          );
        }
        
        return content;
      },
      enableSorting: true,
      sortLabel: "Composition",
    }),
    columnHelper.accessor((row) => row.raw_materials?.name, {
      id: "name",
      header: "Material Name",
      cell: ({ row }) => {
        const isLinked = selectionProps?.linkedItemIds?.has(row.original.inventory_item_id || row.original.id);
        const name = row.original.raw_materials?.name || "-";
        
        const content = (
          <Text size="small" leading="compact" className={isLinked ? "text-ui-fg-subtle" : ""}>
            {name}
          </Text>
        );
        
        if (isLinked) {
          return (
            <Tooltip content="This inventory item is already linked to this design">
              {content}
            </Tooltip>
          );
        }
        
        return content;
      },
      enableSorting: true,
      sortLabel: "Material Name",
    }),
    columnHelper.accessor((row) => row.raw_materials?.material_type?.category, {
      id: "category",
      header: "Category",
      cell: ({ row }) => {
        const isLinked = selectionProps?.linkedItemIds?.has(row.original.inventory_item_id || row.original.id);
        const category = row.original.raw_materials?.material_type?.category || "-";
        
        const content = (
          <Text size="small" leading="compact" className={isLinked ? "text-ui-fg-subtle" : ""}>
            {category}
          </Text>
        );
        
        if (isLinked) {
          return (
            <Tooltip content="This inventory item is already linked to this design">
              {content}
            </Tooltip>
          );
        }
        
        return content;
      },
      enableSorting: true,
      sortLabel: "Category",
    }),
  ];
};
