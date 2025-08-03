import { UseFormReturn } from "react-hook-form";
import { DataGrid } from "../data-grid/data-grid";
import { ColumnDef } from "@tanstack/react-table";
import { Select, Input, CurrencyInput, IconButton, DropdownMenu, Tooltip } from "@medusajs/ui";
import { Trash, InformationCircleSolid } from "@medusajs/icons";
import { HttpTypes } from "@medusajs/types";

interface InventoryOrderLine {
  inventory_item_id: string;
  quantity: number;
  price: number;
}

interface InventoryOrderLinesGridProps<T> {
  form: UseFormReturn<any>;
  orderLines: InventoryOrderLine[];
  inventoryItems: T[];
  onLineChange: (index: number, field: keyof InventoryOrderLine, value: any) => void;
  onAddLine: () => void;
  onRemoveLine: (index: number) => void;
  defaultCurrencySymbol: string;
  defaultCurrencyCode: string;
  isStoreLoading: boolean;
}

export const InventoryOrderLinesGrid = <T extends { id: string; title?: string; sku?: string; width?: string | null; length?: string | null; height?: string | null; weight?: string | number | null; }>({  form,
  orderLines,
  inventoryItems,
  onLineChange,
  onAddLine,
  onRemoveLine,
  defaultCurrencySymbol,
  defaultCurrencyCode,
  isStoreLoading,
}: InventoryOrderLinesGridProps<T>) => {
  // Create columns for the data grid
  const columns: ColumnDef<InventoryOrderLine>[] = [
    {
      id: "item",
      header: "Item",
      cell: ({ row, table }) => {
        const rowIndex = table.getRowModel().rows.findIndex(r => r.id === row.id);
        return (
          <Select
            value={row.original.inventory_item_id}
            onValueChange={(v) => onLineChange(rowIndex, "inventory_item_id", v)}
          >
            <Select.Trigger>
              <Select.Value placeholder="Select item" />
            </Select.Trigger>
            <Select.Content>
              {inventoryItems.map((item) => {
                const disabled = orderLines.some((l, i) => l.inventory_item_id === item.id && i !== rowIndex);
                return (
                  <Select.Item key={item.id} value={item.id} disabled={disabled}>
                    <div className="flex justify-between items-center">
                      <span>{item.title || item.sku}</span>
                      {disabled && (
                        <Tooltip content="Already selected">
                          <InformationCircleSolid className="h-4 w-4 text-ui-fg-subtle" />
                        </Tooltip>
                      )}
                    </div>
                  </Select.Item>
                );
              })}
            </Select.Content>
          </Select>
        );
      },
    },
    {
      id: "quantity",
      header: "Quantity",
      cell: ({ row, table }) => {
        const rowIndex = table.getRowModel().rows.findIndex(r => r.id === row.id);
        return (
          <Input
            type="number"
            value={row.original.quantity}
            onChange={(e) => onLineChange(rowIndex, "quantity", Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rowIndex === orderLines.length - 1) {
                e.preventDefault();
                onAddLine();
              }
            }}
          />
        );
      },
    },
    {
      id: "price",
      header: "Price",
      cell: ({ row, table }) => {
        const rowIndex = table.getRowModel().rows.findIndex(r => r.id === row.id);
        return (
          <CurrencyInput
            symbol={defaultCurrencySymbol}
            code={defaultCurrencyCode}
            value={row.original.price}
            onValueChange={(val) => onLineChange(rowIndex, "price", Number(val))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rowIndex === orderLines.length - 1) {
                e.preventDefault();
                onAddLine();
              }
            }}
            disabled={isStoreLoading}
          />
        );
      },
    },
  ];

  return (
    <DataGrid
      data={orderLines}
      columns={columns}
      state={form}
    />
  );
};
