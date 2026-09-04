import { Controller, UseFormReturn, useWatch } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper";
import { DataGrid } from "../data-grid/data-grid";
import { DataGridCurrencyCell, DataGridNumberCell } from "../data-grid/components";
import { Badge, IconButton, Text, Tooltip } from "@medusajs/ui";
import { Eye, Trash } from "@medusajs/icons";
import { Combobox } from "../inputs/combobox/combobox";
import { InventoryItem, RawMaterial } from "../../hooks/api/raw-materials";
import { MaterialItemModal } from "../inventory-orders/material-item-modal";
import { ThumbnailPreview } from "../common/thumbnail-preview";
import { firstMediaUrl } from "../../lib/utils/first-media-url";

type PickerOption = { label: string; value: string; keywords?: string; disabled?: boolean };

/** A picked catalog row: a material-backed item, a variant-backed one, or neither. */
type PickedInventoryItem = InventoryItem & {
  raw_materials?: RawMaterial | null
  variants?: Array<{
    id: string
    title?: string | null
    sku?: string | null
    // #1744 — the variant's existing price (money amounts per currency), so
    // picking a finished good pre-fills `price`.
    prices?: Array<{ amount?: number | string | null; currency_code?: string | null }>
    product?: { id: string; title?: string | null; thumbnail?: string | null } | null
  }>
  kind?:
    | "raw_material"
    | "product"
    | "both"
    | "unclassified"
    // #1662 — a partner variant that has no inventory item yet. Picking it is
    // what creates one, at our location, when the order is written.
    | "untracked_variant"
  partner?: { id: string; name?: string | null } | null
}

/**
 * Item picker cell — a real (ariakit) Combobox instead of a search box wedged
 * inside a Radix Select. The Select approach fought Radix's focus/typeahead and
 * dropped keystrokes (flaky search); the Combobox is a portaled popover with a
 * stable text input and server-side search wiring. Bound straight to the form so
 * a picked item reflects immediately (no double-click-to-edit dance).
 */
const ItemComboboxCell = ({
  form,
  index,
  options,
  loading,
  onSearch,
  onItemPick,
}: {
  form: UseFormReturn<any>;
  index: number;
  options: PickerOption[];
  loading?: boolean;
  onSearch?: (query: string) => void;
  /** Called with the picked item id so the grid can pre-fill `price` (#1744). */
  onItemPick?: (itemId: string) => void;
}) => {
  const [query, setQuery] = useState("");

  // Debounced server-side search over the full catalog (#831).
  useEffect(() => {
    if (!onSearch) {
      return;
    }
    const handle = setTimeout(() => onSearch(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query, onSearch]);

  // The Combobox runs in controlled-search mode (we drive searchValue), which
  // disables its built-in matchSorter — so on its own the list wouldn't narrow as
  // you type and would show every loaded item (reads as "the search doesn't
  // work"). The whole catalog is fetched once up-front (see create/edit order
  // pages), so narrow it locally here for instant, flicker-free filtering.
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.keywords ? o.keywords.includes(q) : false)
    );
  }, [options, query]);

  return (
    <Controller
      control={form.control}
      name={`order_lines.${index}.inventory_item_id`}
      render={({ field, fieldState }) => (
        <div
          className="flex h-full w-full flex-col justify-center px-2"
          // The grid registers GLOBAL window keydown handlers (arrows/space/
          // enter/backspace = grid navigation) that don't check the target, so
          // they hijack the combobox and made search flaky. Contain key events
          // here: ariakit's handlers on the input have already run by the time
          // this bubbles, and React's stopPropagation also stops the native
          // window listener — WITHOUT toggling grid state (which re-rendered the
          // grid, remounted the cell, and made the dropdown flicker).
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Combobox
            value={(field.value as string) || ""}
            onChange={(v) => {
              const id = (v as string) ?? "";
              field.onChange(id);
              if (id && onItemPick) onItemPick(id);
            }}
            onBlur={field.onBlur}
            searchValue={query}
            onSearchValueChange={setQuery}
            options={filteredOptions}
            allowClear
            // Only disable on the genuine first load (catalog not fetched yet).
            // Disabling a focused input blurs it, closes the dropdown and wipes
            // the typed query — so once we have items, never disable mid-use.
            disabled={loading && options.length === 0}
            placeholder="Search items…"
            // Portal the options out of the virtualized/overflow-clipped grid row.
            portal
          />
          {fieldState.error?.message && (
            <Text size="xsmall" className="text-ui-fg-error mt-1 px-1">
              {fieldState.error.message}
            </Text>
          )}
        </div>
      )}
    />
  );
};

interface InventoryOrderLine {
  inventory_item_id: string;
  quantity: number;
  price: number;
  // Per-unit extra charge on top of price (colour/dye job, finishing, …).
  extra_cost?: number;
  batch_number?: number | null;
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

  // The `orderLines` prop is react-hook-form's `fields` array — a snapshot whose
  // values only change on structural edits (append/remove), NOT when a cell's
  // value is edited in place. Reading it for the Color pill / details eye meant
  // they only refreshed after the next row was added. Watch the live form values
  // instead so a picked item reflects immediately in the same render.
  const watchedLines =
    (useWatch({ control: form.control, name: "order_lines" }) as
      | InventoryOrderLine[]
      | undefined) ?? orderLines;
  const lineAt = (index: number): InventoryOrderLine | undefined =>
    watchedLines?.[index] ?? orderLines?.[index];

  useEffect(() => {
    const duplicateIndexes = new Set<number>();
    const seen = new Map<string, number[]>();

    watchedLines.forEach((line, index) => {
      if (!line?.inventory_item_id) {
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

    watchedLines.forEach((_, index) => {
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
  }, [watchedLines, setError, clearErrors]);

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
      // #1662 — an item can be variant-backed instead of material-backed
      // (finished fabric / finished goods bought from a partner). Those have
      // no raw-material name, so the product/variant is what names them.
      const variant = (item?.variants ?? [])[0]
      const productLabel = [variant?.product?.title, variant?.title]
        .filter(Boolean)
        .join(" · ")
      const baseLabel = raw?.name || productLabel || inv?.title || inv?.sku || ""
      // #846 — many colors of one material share the same raw-material name
      // (e.g. 12 "Tangaliya weave suit piece"), which made the picker options
      // visually identical and read as "missing/duplicate items". Disambiguate
      // the visible label with color and SKU so every option is distinct.
      const color = raw?.color
      const sku = inv?.sku || variant?.sku
      // Don't re-append a color the name already carries (newer group colors
      // fold the color into the raw-material name at creation — #846).
      const showColor =
        color && !baseLabel.toLowerCase().includes(String(color).toLowerCase())
      // #1662 — whose fabric is this? A buyer choosing between two partners'
      // near-identical greige needs the owner on the option, not one click away.
      const partnerName = item?.partner?.name
      const label = [
        baseLabel,
        showColor ? `— ${color}` : "",
        sku ? `(${sku})` : "",
        partnerName ? `· ${partnerName}` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || baseLabel
      const value = item?.inventory_item_id || inv?.id || item?.id
      // Searchable keywords beyond the visible name so the picker matches on
      // color / material / sku too (#831 — quick matching).
      const keywords = [
        raw?.name,
        raw?.color,
        raw?.material_name,
        inv?.title,
        inv?.sku,
        variant?.title,
        variant?.sku,
        variant?.product?.title,
        item?.partner?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return { label, value, keywords }
    })
  }, [mergedItems])

  const inventoryItemMap = useMemo(() => {
    const map = new Map<string, PickedInventoryItem | null>()
    mergedItems.forEach((item: any) => {
      const inv = (item?.inventory_item ?? item) as InventoryItem | undefined
      const raw = item?.raw_materials as RawMaterial | undefined
      const value = item?.inventory_item_id || inv?.id || item?.id
      if (value) {
        map.set(
          value,
          inv
            ? {
                ...inv,
                raw_materials: raw,
                // #1662 — what the line is FOR, when it is not a material.
                variants: item?.variants ?? [],
                kind: item?.kind,
                partner: item?.partner ?? null,
              }
            : null
        )
      }
    })
    return map
  }, [mergedItems])

  /**
   * #1744 — the existing per-unit price to pre-fill when an item is picked.
   *
   * A raw-material-backed item prices from its material's `unit_cost`; a
   * finished-good/variant item prices from the variant's money amounts,
   * INR-matched (never "the first price" — a variant carries a row per
   * currency, so prices[0] mixes INR with USD). Null when the item has no
   * readable price, so the buyer's 0 stands rather than being overwritten.
   */
  const existingPriceFor = (itemId: string): number | null => {
    const item = inventoryItemMap.get(itemId)
    if (!item) return null
    const unitCost = item.raw_materials?.unit_cost
    if (unitCost != null && Number.isFinite(Number(unitCost))) {
      return Number(unitCost)
    }
    const variant = (item.variants ?? [])[0]
    const prices = variant?.prices ?? []
    const inr = prices.find(
      (p) => String(p?.currency_code ?? "").toLowerCase() === "inr"
    )
    const match = inr ?? prices[0]
    return match?.amount != null && Number.isFinite(Number(match.amount))
      ? Number(match.amount)
      : null
  }

  const columns: ColumnDef<InventoryOrderLine>[] = [
    columnHelper.column({
      id: "image",
      name: "Image",
      header: "Image",
      cell: (context: any) => {
        const inventoryItemId =
          lineAt(context.row.index)?.inventory_item_id || ""
        const inventoryItem = inventoryItemId
          ? inventoryItemMap.get(inventoryItemId) || null
          : null
        const photo =
          firstMediaUrl(inventoryItem?.raw_materials?.media) ||
          inventoryItem?.thumbnail ||
          undefined
        return (
          <div className="flex h-full items-center justify-center px-2">
            <ThumbnailPreview
              src={photo}
              alt={inventoryItem?.title || "Item"}
              size="small"
            />
          </div>
        )
      },
    }),
    columnHelper.column({
      id: "item",
      name: "Item",
      header: "Item",
      cell: (context: any) => {
        const rowIndex = context.row.index;

        // Disable items already picked in another row (live values).
        const rowOptions = options.map((option) => ({
          ...option,
          disabled: watchedLines.some(
            (line, index) =>
              line?.inventory_item_id === option.value && index !== rowIndex
          ),
        }));

        return (
          <ItemComboboxCell
            form={form}
            index={rowIndex}
            options={rowOptions}
            loading={loading}
            onSearch={onSearchItems}
            onItemPick={(itemId) => {
              const price = existingPriceFor(itemId)
              if (price != null) {
                form.setValue(`order_lines.${rowIndex}.price`, price)
              }
            }}
          />
        );
      },
      disableHiding: true,
    }),
    columnHelper.column({
      id: "kind",
      name: "Type",
      header: "Type",
      cell: (context: any) => {
        // #1662 — a partner making a garment FOR us is a production run; a
        // partner selling us finished stock is this. Once the picker can see
        // both, the same real-world event could be recorded either way, so the
        // distinction has to be visible on the line rather than left to
        // whoever opened the form.
        const inventoryItemId =
          lineAt(context.row.index)?.inventory_item_id || ""
        const item = inventoryItemId
          ? inventoryItemMap.get(inventoryItemId)
          : null
        const variant = (item?.variants ?? [])[0]
        const untracked = item?.kind === "untracked_variant"
        // Kept to ONE word. The Type column is narrow: a three-word badge
        // wrapped to three lines and overflowed the row, clipping itself above
        // and below the cell. Seen only by rendering it.
        const label = item?.raw_materials
          ? "Material"
          : untracked
          ? "Untracked"
          : variant
          ? "Finished"
          : null
        const detail = item?.raw_materials
          ? null
          : [
              [variant?.product?.title, variant?.title]
                .filter(Boolean)
                .join(" · "),
              item?.partner?.name ? `from ${item.partner.name}` : "",
            ]
              .filter(Boolean)
              .join(" ")

        // Say what picking this row will DO — it turns tracking on for the
        // variant at our location, a real side effect of placing the order.
        // It rides on the badge's tooltip rather than in the cell, because the
        // cell truncates and the sentence was never actually readable there.
        const hint = untracked
          ? "This variant does not track stock yet. Ordering it creates its inventory item at the destination location, starting at 0."
          : item?.raw_materials
          ? "Raw material."
          : variant
          ? "Finished goods bought in, not made."
          : undefined

        return (
          <div className="flex h-full items-center gap-x-2 px-4">
            {label ? (
              <Badge
                size="2xsmall"
                className="whitespace-nowrap"
                title={hint}
                color={
                  item?.raw_materials ? "grey" : untracked ? "orange" : "blue"
                }
              >
                {label}
              </Badge>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                —
              </Text>
            )}
            {detail ? (
              <Text size="small" className="truncate text-ui-fg-subtle">
                {detail}
              </Text>
            ) : null}
          </div>
        )
      },
    }),
    columnHelper.column({
      id: "color",
      name: "Color",
      header: "Color",
      cell: (context: any) => {
        const inventoryItemId =
          lineAt(context.row.index)?.inventory_item_id || "";
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
      id: "batch",
      name: "Batch",
      header: "Batch",
      cell: (context: any) => {
        const batch = lineAt(context.row.index)?.batch_number;
        return (
          <div className="flex h-full items-center px-4">
            {batch ? (
              <Badge size="2xsmall" color="blue">
                {`#${batch}`}
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
            // 🔴 NO `min={1}` here (#1671). It becomes a native
            // `<input type="number" min="1">`, and the form seeds FIVE blank
            // rows whose quantity is 0. Native constraint validation then
            // refuses to submit the whole form — before React Hook Form or zod
            // is consulted, so no submit event fires at all — and because the
            // offending inputs live inside a horizontally scrolled grid the
            // browser cannot scroll to them to show its own bubble. The result
            // was a Create button that did nothing, silently, forever.
            // The rule still exists, in the schema, where a BLANK row can be
            // told apart from an unfinished one and the error can be attached
            // to the row the buyer must fix.
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
      id: "extra_cost",
      name: "Extra Cost",
      header: "Extra Cost",
      // Per-unit charge a partner adds on top of price (colour job, finishing, …).
      field: (context: any) => `order_lines.${context.row.index}.extra_cost`,
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
          lineAt(context.row.index)?.inventory_item_id || ""
        const inventoryItem = inventoryItemId
          ? inventoryItemMap.get(inventoryItemId) || null
          : null

        const removeRow = () => {
          onRemoveRow(context.row.index);
        };

        const disabled =
          watchedLines.length <= 1 &&
          !watchedLines.some((line) => line?.inventory_item_id);

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
      if (col.id === "image") {
        return { ...col, size: 72, maxSize: 96 }
      }
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
      if (col.id === "extra_cost") {
        return { ...col, size: 200, maxSize: 300 }
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