import { ColumnDef } from "@tanstack/react-table"
import { CellContext } from "@tanstack/react-table"
import { useMemo } from "react"
import { useWatch } from "react-hook-form"

import { createDataGridHelper } from "../../../../components/data-grid"
import {
  DataGridBooleanCell,
  DataGridCurrencyCell,
  DataGridNumberCell,
  DataGridReadOnlyCell,
} from "../../../../components/data-grid/components"
import { useDataGridContext } from "../../../../components/data-grid/context"
import { OrderLineRow, EditInventoryOrderLinesSchemaType } from "./schema"

const columnHelper = createDataGridHelper<
  OrderLineRow,
  EditInventoryOrderLinesSchemaType
>()

/**
 * The item name, struck through once the row is ticked for removal.
 *
 * A component rather than an inline `cell` function, because it reads LIVE form
 * state: `context.row.original.remove` is the seeded value and is false
 * forever. Without this the only feedback for ticking Remove was the checkbox
 * itself — a row three columns wide still showing a quantity and a price it no
 * longer intends to order.
 */
const LineTitleCell = ({
  context,
}: {
  context: CellContext<OrderLineRow, unknown>
}) => {
  const { control } = useDataGridContext()
  const line = context.row.original
  const removed = useWatch({
    control,
    name: `order_lines.${context.row.index}.remove`,
  })

  return (
    <DataGridReadOnlyCell context={context} color="normal">
      <div className="flex h-full w-full flex-col justify-center overflow-hidden">
        <span
          className={removed ? "truncate line-through text-ui-fg-muted" : "truncate"}
          title={line.title}
        >
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
}

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
        cell: (context) => <LineTitleCell context={context} />,
        disableHiding: true,
      }),
      columnHelper.column({
        id: "quantity",
        name: "Quantity",
        header: "Quantity",
        field: (context) => `order_lines.${context.row.index}.quantity`,
        type: "number",
        /**
         * 🔑 `step="any"`. Cloth is ordered in metres and yarn in kilograms —
         * `inventory_order_line.quantity` is a Postgres `real`. The default
         * `step=1` on `type="number"` marks 12.5 as invalid and steps the
         * spinner in whole units, on a field that was never counting pieces.
         */
        cell: (context) => (
          <DataGridNumberCell
            context={context}
            step="any"
            placeholder=""
            data-testid="inv-change-quantity"
          />
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
