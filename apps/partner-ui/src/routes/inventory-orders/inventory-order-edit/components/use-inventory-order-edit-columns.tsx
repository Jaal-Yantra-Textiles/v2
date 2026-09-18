import { ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"

import { createDataGridHelper } from "../../../../components/data-grid"
import {
  DataGridBooleanCell,
  DataGridCurrencyCell,
  DataGridNumberCell,
  DataGridReadOnlyCell,
} from "../../../../components/data-grid/components"
import { OrderLineRow, EditInventoryOrderLinesSchemaType } from "./schema"

const columnHelper = createDataGridHelper<
  OrderLineRow,
  EditInventoryOrderLinesSchemaType
>()

/**
 * #1752 — DataGrid columns for the partner's inventory order-line edit.
 * `title` is read-only (a partner names no new items); `quantity` / `price` /
 * `extra_cost` are editable and bound to `order_lines.{index}.*`; `remove`
 * flags a line for removal. A removed line contributes nothing to the total.
 */
export const useInventoryOrderEditColumns = (
  currencyCode: string
): ColumnDef<OrderLineRow, unknown>[] => {
  return useMemo(
    () => [
      columnHelper.column({
        id: "title",
        name: "Item",
        header: "Item",
        cell: (context) => {
          const line = context.row.original
          return (
            <DataGridReadOnlyCell context={context} color="normal">
              <div className="flex h-full w-full flex-col justify-center overflow-hidden">
                <span className="truncate" title={line.title}>
                  {line.title}
                </span>
                {line.sku ? (
                  <span className="text-ui-fg-subtle truncate text-xs">
                    SKU {line.sku}
                  </span>
                ) : null}
              </div>
            </DataGridReadOnlyCell>
          )
        },
        disableHiding: true,
      }),
      columnHelper.column({
        id: "quantity",
        name: "Quantity",
        header: "Quantity",
        field: (context) => `order_lines.${context.row.index}.quantity`,
        type: "number",
        cell: (context) => (
          <DataGridNumberCell context={context} placeholder="" />
        ),
        disableHiding: true,
      }),
      columnHelper.column({
        id: "price",
        name: "Price",
        header: "Price",
        field: (context) => `order_lines.${context.row.index}.price`,
        type: "number",
        cell: (context) => (
          <DataGridCurrencyCell context={context} code={currencyCode} />
        ),
        disableHiding: true,
      }),
      columnHelper.column({
        id: "extra_cost",
        name: "Extra Cost",
        header: "Extra Cost",
        field: (context) => `order_lines.${context.row.index}.extra_cost`,
        type: "number",
        cell: (context) => (
          <DataGridCurrencyCell context={context} code={currencyCode} />
        ),
      }),
      columnHelper.column({
        id: "remove",
        name: "Remove",
        header: "Remove",
        field: (context) => `order_lines.${context.row.index}.remove`,
        type: "boolean",
        cell: (context) => <DataGridBooleanCell context={context} />,
      }),
    ],
    [currencyCode]
  )
}