import { UseFormReturn } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper";
import { DataGrid } from "../data-grid/data-grid";
import { DataGridCurrencyCell, DataGridNumberCell } from "../data-grid/components";
import { DataGridSelectCell } from "../data-grid/components/data-grid-select-cell";
import { Badge, IconButton, Text, Tooltip } from "@medusajs/ui";
import { Eye, Trash } from "@medusajs/icons";
import { InventoryItem, RawMaterial } from "../../hooks/api/raw-materials";
import { MaterialItemModal } from "../inventory-orders/material-item-modal";

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
  loading?: boolean;
  /**
   * Server-side search callback for the item picker. When provided, the picker's
   * search box queries the full catalog instead of filtering only the loaded page.
   */
  onSearchItems?: (query: string) => void;
}

export const InventoryOrderLinesGrid = <T extends { id: string; title?: string; sku?: string; width?: string | null; length?: string | null; height?: string | null; weight?: string | number | null; }>({
  form,
  orderLines,
  inventoryItems,
  defaultCurrencyCode,
  onAddNewRow,
  onRemoveRow,
  loading,
  onSearchItems,
}: InventoryOrderLinesGridProps<T>) => {
  // Create columns for the data grid using DataGrid helpers
  const columnHelper = createDataGridHelper<InventoryOrderLine, any>();
  const { setError, clearErrors } = form;

  // #832 — the item-details modal is rendered once at the grid root and driven
  // by this state, so grid re-renders (which rebuild the columns) can't wipe it.
  const [detailItem, setDetailItem] = useState<
    (InventoryItem & { raw_materials?: RawMaterial | null }) | null
  >(null);

  useEffect(() => {
    const duplicateIndexes = new Set<number>();
    const seen = new Map<string, number[]>();

    orderLines.forEach((line, index) => {
      if (!line.inventory_item_id) {
        return;
      }
      const list = seen.get(line.inventory_item_id) ?? [];
      list.push(index);
      seen.set(line.inventory_item_id, list);
    });

    seen.forEach((indexes) => {
      if (indexes.length > 1) {
        indexes.forEach((idx) => duplicateIndexes.add(idx));
      }
    });

    orderLines.forEach((_, index) => {
      const fieldName = `order_lines.${index}.inventory_item_id` as const;
      if (duplicateIndexes.has(index)) {
        setError(fieldName, {
          type: "duplicate",
          message: "Item already used in another row",
        });
      } else {
        clearErrors(fieldName);
      }
    });
  }, [orderLines, setError, clearErrors]);

  const keyOf = (item: any) =>
    item?.inventory_item_id || (item?.inventory_item ?? item)?.id || item?.id

  // #831 — accumulate every item we've ever loaded (across server searches) so
  // that narrowing the picker with a query never drops items already selected in
  // other rows. Without this, searching in one cell would blank out selections
  // elsewhere once those items fall out of the fetched page.
  const [mergedItems, setMergedItems] = useState<T[]>(inventoryItems)
  useEffect(() => {
    if (!inventoryItems.length) {
      return
    }
    setMergedItems((prev) => {
      const map = new Map<string, T>()
      for (const it of prev) {
        const v = keyOf(it)
        if (v) map.set(v, it)
      }
      for (const it of inventoryItems) {
        const v = keyOf(it)
        if (v) map.set(v, it)
      }
      return Array.from(map.values())
    })
  }, [inventoryItems])

  // Build options once per inventory change or search query change
  const options = useMemo(() => {
    return mergedItems.map((item: any) => {
      const inv = item?.inventory_item ?? item
      const raw = item?.raw_materials
      const rawLabel = raw?.name || inv?.title || inv?.sku || ""
      const value = item?.inventory_item_id || inv?.id || item?.id
      // Searchable keywords beyond the visible name so the picker matches on
      // color / material / sku too (#831 — quick matching).
      const keywords = [raw?.name, raw?.color, raw?.material_name, inv?.title, inv?.sku]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return { label: rawLabel, value, keywords }
    })
  }, [mergedItems])

  const inventoryItemMap = useMemo(() => {
    const map = new Map<
      string,
      (InventoryItem & { raw_materials?: RawMaterial | null }) | null
    >()
    mergedItems.forEach((item: any) => {
      const inv = (item?.inventory_item ?? item) as InventoryItem | undefined
      const raw = item?.raw_materials as RawMaterial | undefined
      const value = item?.inventory_item_id || inv?.id || item?.id
      if (value) {
        map.set(value, inv ? { ...inv, raw_materials: raw } : null)
      }
    })
    return map
  }, [mergedItems])

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
            searchable
            onSearch={onSearchItems}
          />
        );
      },
      disableHiding: true,
    }),
    columnHelper.column({
      id: "color",
      name: "Color",
      header: "Color",
      cell: (context: any) => {
        const inventoryItemId =
          orderLines?.[context.row.index]?.inventory_item_id || "";
        const color = inventoryItemId
          ? inventoryItemMap.get(inventoryItemId)?.raw_materials?.color
          : null;
        return (
          <div className="flex h-full items-center px-4">
            {color ? (
              <Badge size="2xsmall" color="grey" className="capitalize">
                {color}
              </Badge>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                —
              </Text>
            )}
          </div>
        );
      },
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
            step="any"
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
    columnHelper.column({
      id: "actions",
      name: "Actions",
      header: "",
      cell: (context: any) => {
        if (!onRemoveRow) {
          return null;
        }

        const inventoryItemId =
          orderLines?.[context.row.index]?.inventory_item_id || ""
        const inventoryItem = inventoryItemId
          ? inventoryItemMap.get(inventoryItemId) || null
          : null

        const removeRow = () => {
          onRemoveRow(context.row.index);
        };

        const disabled =
          orderLines.length <= 1 &&
          !orderLines.some((line) => line.inventory_item_id);

        return (
          <div className="flex items-center justify-center gap-1.5">
            <Tooltip
              content={inventoryItem ? "View item details" : "Select an item first"}
              side="left"
            >
              <IconButton
                type="button"
                size="small"
                variant="transparent"
                className="text-ui-fg-muted hover:text-ui-fg-base"
                disabled={!inventoryItem}
                onClick={() => inventoryItem && setDetailItem(inventoryItem)}
              >
                <Eye />
                <span className="sr-only">View item details</span>
              </IconButton>
            </Tooltip>
            <Tooltip content="Remove row" side="left">
              <IconButton
                type="button"
                size="small"
                variant="transparent"
                className="text-ui-fg-muted hover:text-ui-fg-base"
                disabled={disabled}
                onClick={removeRow}
              >
                <Trash />
                <span className="sr-only">Remove row</span>
              </IconButton>
            </Tooltip>
          </div>
        );
      },
    }),
  ];

  // Increase widths for a more comfortable layout
  const sizedColumns: ColumnDef<InventoryOrderLine>[] = useMemo(() => {
    return columns.map((col) => {
      if (col.id === "item") {
        return { ...col, size: 480, maxSize: 720 }
      }
      if (col.id === "color") {
        return { ...col, size: 160, maxSize: 220 }
      }
      if (col.id === "quantity") {
        return { ...col, size: 180, maxSize: 240 }
      }
      if (col.id === "price") {
        return { ...col, size: 220, maxSize: 320 }
      }
      if (col.id === "actions") {
        return { ...col, size: 120, maxSize: 140 }
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
      <Text size="xsmall" className="text-ui-fg-muted mt-2">
        Tip: use Delete to drop the last line, the eye icon to inspect details, or the trash icon to remove a specific row.
      </Text>
      <MaterialItemModal
        item={detailItem}
        open={!!detailItem}
        onOpenChange={(open) => {
          if (!open) {
            setDetailItem(null);
          }
        }}
      />
    </div>
  );
};