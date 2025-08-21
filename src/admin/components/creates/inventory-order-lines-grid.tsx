import { UseFormReturn } from "react-hook-form";
import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper";
import { DataGrid } from "../data-grid/data-grid";
import { DataGridCurrencyCell, DataGridNumberCell } from "../data-grid/components";
import { DataGridSelectCell } from "../data-grid/components/data-grid-select-cell";

interface InventoryOrderLine {
  inventory_item_id: string;
  quantity: number;
  price: number;
}

interface InventoryOrderLinesGridProps<T> {
  form: UseFormReturn<any>;
  orderLines: InventoryOrderLine[];
  inventoryItems: T[];
  defaultCurrencyCode: string;
  onAddNewRow: () => void;
  onRemoveRow?: (index: number) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  loading?: boolean;
}

export const InventoryOrderLinesGrid = <T extends { id: string; title?: string; sku?: string; width?: string | null; length?: string | null; height?: string | null; weight?: string | number | null; }>({
  form,
  orderLines,
  inventoryItems,
  defaultCurrencyCode,
  onAddNewRow,
  onRemoveRow,
  searchQuery,
  onSearchChange,
  loading,
}: InventoryOrderLinesGridProps<T>) => {
  // Create columns for the data grid using DataGrid helpers
  const columnHelper = createDataGridHelper<InventoryOrderLine, any>();

  const highlight = (text: string, query?: string) => {
    if (!query) return text
    if (!text) return text
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const escaped = escapeRegExp(query)
    const re = new RegExp(`(${escaped})`, "ig")
    const parts = text.split(re)
    if (parts.length === 1) return text
    return (
      <>
        {parts.map((part, idx) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={idx} className="bg-ui-bg-subtle text-ui-fg-base rounded px-0.5">{part}</span>
          ) : (
            <span key={idx}>{part}</span>
          )
        )}
      </>
    )
  }

  // Build options once per inventory change or search query change
  const options = useMemo(() => {
    return inventoryItems.map((item: any) => {
      const inv = item?.inventory_item ?? item
      const raw = item?.raw_materials
      const rawLabel = raw?.name || inv?.title || inv?.sku || ""
      const value = item?.inventory_item_id || inv?.id || item?.id
      return { label: rawLabel, value }
    })
  }, [inventoryItems])

  const columns: ColumnDef<InventoryOrderLine>[] = [
    columnHelper.column({
      id: "item",
      name: "Item",
      header: "Item",
      field: (context: any) => `order_lines.${context.row.index}.inventory_item_id`,
      type: "text",
      cell: (context: any) => {
        const rowIndex = context.row.index;

        // Check if item is already selected in other rows
        const isOptionDisabled = (optionValue: string) => {
          return orderLines.some((line, index) => 
            line.inventory_item_id === optionValue && index !== rowIndex
          );
        };

        return (
          <DataGridSelectCell
            context={context}
            options={options.map((option: any) => ({
              ...option,
              disabled: isOptionDisabled(option.value)
            }))}
            loading={loading}
          />
        );
      },
      disableHiding: true,
    }),
    columnHelper.column({
      id: "quantity",
      name: "Quantity",
      header: "Quantity",
      field: (context: any) => `order_lines.${context.row.index}.quantity`,
      type: "number",
      cell: (context: any) => {
        return (
          <DataGridNumberCell
            context={context}
            min={1}
            placeholder=""
          />
        );
      },
      disableHiding: true,
    }),
    columnHelper.column({
      id: "price",
      name: "Price",
      header: "Price",
      field: (context: any) => `order_lines.${context.row.index}.price`,
      type: "number",
      cell: (context: any) => {
        return (
          <DataGridCurrencyCell
            context={context}
            code={defaultCurrencyCode}
          />
        );
      },
      disableHiding: true,
    }),
  ];

  // Increase widths for a more comfortable layout
  const sizedColumns: ColumnDef<InventoryOrderLine>[] = useMemo(() => {
    return columns.map((col) => {
      if (col.id === "item") {
        return { ...col, size: 600, maxSize: 800 }
      }
      if (col.id === "quantity") {
        return { ...col, size: 180, maxSize: 240 }
      }
      if (col.id === "price") {
        return { ...col, size: 220, maxSize: 320 }
      }
      return col
    })
  }, [columns])

  // Add a new empty row when Enter is pressed in the last row
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Check if Enter key is pressed
    if (e.key === 'Enter') {
      // Check if we're in the last row by checking if the active element is in the last row
      const activeElement = document.activeElement;
      const gridContainer = activeElement?.closest('[role="grid"]');
      
      if (gridContainer) {
        // Get all rows in the grid
        const rows = gridContainer.querySelectorAll('[role="row"]:not(:first-child)'); // Exclude header row
        if (rows.length > 0) {
          // Check if the active element is in the last row
          const lastRow = rows[rows.length - 1];
          if (lastRow && lastRow.contains(activeElement)) {
            // Add a new empty row
            onAddNewRow();
            e.preventDefault();
          }
        }
      }
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
      <DataGrid
        data={orderLines}
        columns={sizedColumns}
        state={form}
        onRemoveRow={onRemoveRow}
      />
    </div>
  );
};