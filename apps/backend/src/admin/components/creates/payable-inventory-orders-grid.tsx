import { useEffect, useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { Badge, CommandBar, Container, Text } from "@medusajs/ui"

import { DataGrid } from "../data-grid/data-grid"
import {
  DataGridBooleanCell,
  DataGridNumberCell,
  DataGridReadOnlyCell,
} from "../data-grid/components"
import { createDataGridHelper } from "../data-grid/helpers/create-data-grid-column-helper"
import { PayableInventoryOrder } from "../../hooks/api/payment-submissions"

/**
 * Inventory orders a partner may be paid for — GOODS, as opposed to work.
 *
 * A production run is the work and its expenses; an inventory order is stock
 * coming IN. Both are things a partner is owed for, and `create` has accepted
 * `inventory_order_lines` since #1612 — validator, partner-ownership guard,
 * read-side resolution, the lot. Nothing ever sent one, because no screen
 * offered them. On production, NO payment carries an `inventory_order_id`: a
 * capability with no way to reach it is a capability nobody has.
 *
 * ## The two numbers that are not the same
 *
 * 🔴 What is OWED comes from the RECEIPTS, never from the ordered total. An
 * order placed for ₹88,885 with ₹28,670 actually delivered is owed ₹28,670 —
 * billing the ordered total there overpays by ₹60,215 (#1612).
 *
 * 🔴 But the guard's CEILING is the ordered total, and the receipts figure can
 * legitimately sit above it (₹64,274 derived against ₹63,375.75 ordered on the
 * order that opened #1617). So a row offers the receipts value CAPPED at what
 * is left, says when the cap bit, and keeps the raw figure beside it. Offering
 * the uncapped number would be a screen teaching the rule through a 400.
 *
 * ## What is shown rather than hidden
 *
 * An order with no receipts recorded is listed, marked, and not selectable.
 * "Why isn't this order here" is the question an operator arrives with, and no
 * receipt is a gap in the record — not a statement that the goods were free.
 */

type OrderRow = {
  order: PayableInventoryOrder
  index: number
}

type GridValues = {
  rows: Array<{ selected: boolean; amount: number }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const PayableInventoryOrdersGrid = ({
  orders,
  isLoading,
  selectedIds,
  amountOverrides,
  onSelectionChange,
  onAmountChange,
  onClearSelection,
  getAmount,
}: {
  orders: PayableInventoryOrder[]
  isLoading: boolean
  selectedIds: Set<string>
  amountOverrides: Record<string, number>
  onSelectionChange: (orderId: string, selected: boolean) => void
  onAmountChange: (orderId: string, value: string) => void
  onClearSelection: () => void
  getAmount: (order: PayableInventoryOrder) => number
}) => {
  const rows: OrderRow[] = useMemo(
    () => orders.map((order, index) => ({ order, index })),
    [orders]
  )

  const form = useForm<GridValues>({
    defaultValues: {
      rows: orders.map((order) => ({
        selected: selectedIds.has(order.inventory_order_id),
        amount: getAmount(order),
      })),
    },
  })

  /**
   * Re-seed when a different partner's orders arrive. Keyed on the ids rather
   * than the array, so a refetch cannot wipe a figure being typed.
   */
  const orderKey = orders.map((o) => o.inventory_order_id).join(",")
  useEffect(() => {
    form.reset({
      rows: orders.map((order) => ({
        selected: selectedIds.has(order.inventory_order_id),
        amount: getAmount(order),
      })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])

  const watched = useWatch({ control: form.control, name: "rows" }) as
    | GridValues["rows"]
    | undefined

  useEffect(() => {
    if (!watched) {
      return
    }
    watched.forEach((row, index) => {
      const order = orders[index]
      if (!order) {
        return
      }

      const nextSelected = !!row?.selected && order.payable
      if (nextSelected !== selectedIds.has(order.inventory_order_id)) {
        onSelectionChange(order.inventory_order_id, nextSelected)
      }

      const nextAmount = Number(row?.amount)
      if (Number.isFinite(nextAmount) && nextAmount !== getAmount(order)) {
        onAmountChange(order.inventory_order_id, String(nextAmount))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched])

  const columnHelper = createDataGridHelper<OrderRow, GridValues>()

  const columns = useMemo(
    () => [
      columnHelper.column({
        id: "selected",
        name: "Bill",
        header: "Bill",
        field: (context: any) => `rows.${context.row.index}.selected`,
        type: "boolean",
        disableHiding: true,
        cell: (context: any) => (
          <DataGridBooleanCell
            context={context}
            // Nothing to bill: no receipt recorded, or the order is already
            // fully claimed. Disabled rather than absent — the row still
            // answers "where is this order".
            disabled={!rows[context.row.index]?.order.payable}
          />
        ),
      }),
      columnHelper.column({
        id: "order",
        name: "Order",
        header: "Order",
        disableHiding: true,
        cell: (context: any) => {
          const order = rows[context.row.index]?.order
          if (!order) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              {/* The id lives here — the grid renders its own rows and offers
                  no hook for a per-row attribute. */}
              <div
                className="flex w-full items-center gap-x-2 overflow-hidden"
                data-testid="payable-inventory-order-row"
                data-inventory-order-id={order.inventory_order_id}
              >
                <Text size="small" className="truncate font-mono">
                  {order.inventory_order_id.slice(0, 22)}…
                </Text>
                {order.status && (
                  <Badge color="grey" size="2xsmall" className="shrink-0">
                    {order.status}
                  </Badge>
                )}
                {order.is_sample && (
                  <Badge color="purple" size="2xsmall" className="shrink-0">
                    sample
                  </Badge>
                )}
                {order.claimed_total > 0 && (
                  <Badge color="orange" size="2xsmall" className="shrink-0">
                    part-paid
                  </Badge>
                )}
                {!order.payable && (
                  <Badge color="red" size="2xsmall" className="shrink-0">
                    {order.receipts_total > 0 ? "fully paid" : "no receipts"}
                  </Badge>
                )}
              </div>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "received",
        name: "Received",
        header: "Received",
        cell: (context: any) => {
          const order = rows[context.row.index]?.order
          if (!order) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              <Text size="small" className="truncate">
                {order.received_quantity} unit
                {order.received_quantity === 1 ? "" : "s"}
                {order.lines.length
                  ? ` · ${order.lines.length} line${order.lines.length === 1 ? "" : "s"}`
                  : ""}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "worth",
        name: "Delivered value",
        header: "Delivered value",
        cell: (context: any) => {
          const order = rows[context.row.index]?.order
          if (!order) {
            return <DataGridReadOnlyCell context={context} />
          }
          /**
           * Receipts against what was ordered, side by side. Which one the
           * amount is built from is stated in "Basis" rather than inferred by
           * the reader — the two are routinely different and that is normal,
           * not an error.
           */
          return (
            <DataGridReadOnlyCell context={context}>
              <Text size="small" className="truncate tabular-nums">
                {order.receipts_total.toLocaleString()} of{" "}
                {order.ordered_total == null
                  ? "—"
                  : order.ordered_total.toLocaleString()}{" "}
                ordered
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "claimed",
        name: "Already billed",
        header: "Already billed",
        cell: (context: any) => {
          const order = rows[context.row.index]?.order
          if (!order) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              <Text size="small" className="truncate tabular-nums">
                {order.claimed_total > 0
                  ? `${order.claimed_total.toLocaleString()} · ${
                      order.remaining == null
                        ? "—"
                        : order.remaining.toLocaleString()
                    } left`
                  : "—"}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
      columnHelper.column({
        id: "amount",
        name: "Amount",
        header: "Amount",
        field: (context: any) => `rows.${context.row.index}.amount`,
        type: "number",
        cell: (context: any) => (
          // 🔴 NO `min` — a native constraint refuses the whole form before any
          // handler runs, silently, with no submit event to observe (#1671).
          <DataGridNumberCell context={context} />
        ),
      }),
      columnHelper.column({
        id: "basis",
        name: "Basis",
        header: "Basis",
        cell: (context: any) => {
          const order = rows[context.row.index]?.order
          if (!order) {
            return <DataGridReadOnlyCell context={context} />
          }
          return (
            <DataGridReadOnlyCell context={context}>
              <Text
                size="small"
                className="truncate"
                data-testid={`inventory-basis-${order.inventory_order_id}`}
              >
                {!order.payable
                  ? order.receipts_total > 0
                    ? "already claimed in full"
                    : "no receipts recorded"
                  : order.capped_by_ceiling
                    ? "capped at the ordered total"
                    : "what was delivered"}
              </Text>
            </DataGridReadOnlyCell>
          )
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, amountOverrides]
  )

  const sizedColumns = useMemo(
    () =>
      columns.map((col: any) => {
        if (col.id === "selected") return { ...col, size: 72, maxSize: 88 }
        if (col.id === "order") return { ...col, size: 340, maxSize: 520 }
        if (col.id === "received") return { ...col, size: 150, maxSize: 200 }
        if (col.id === "worth") return { ...col, size: 220, maxSize: 300 }
        if (col.id === "claimed") return { ...col, size: 180, maxSize: 240 }
        if (col.id === "amount") return { ...col, size: 140, maxSize: 200 }
        if (col.id === "basis") return { ...col, size: 210, maxSize: 280 }
        return col
      }),
    [columns]
  )

  const selectedOrders = orders.filter((o) =>
    selectedIds.has(o.inventory_order_id)
  )
  const selectedTotal = round2(
    selectedOrders.reduce((sum, order) => sum + getAmount(order), 0)
  )

  if (isLoading) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          Loading inventory orders...
        </Text>
      </Container>
    )
  }

  if (!orders.length) {
    return (
      <Container className="p-8">
        <Text className="text-ui-fg-subtle text-center">
          No inventory orders for this partner. These are goods you bought from
          them — a production run is the work instead.
        </Text>
      </Container>
    )
  }

  const billableCount = orders.filter((o) => o.payable).length

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          {billableCount} billable of {orders.length}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          Arrow keys to move · Enter to edit · ⇧↓ to extend · ⌘C/⌘V to fill down
        </Text>
      </div>

      <DataGrid
        data={rows}
        columns={sizedColumns as any}
        state={form}
        multiColumnSelection
      />

      <Text size="xsmall" className="text-ui-fg-subtle">
        An order bills what was DELIVERED, not what was ordered — the two are
        routinely different and only receipts are money owed. An order can be
        billed in tranches, so "already billed" is what previous submissions
        took and the amount is capped at what is left.
      </Text>

      <CommandBar open={selectedOrders.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            {selectedOrders.length} order
            {selectedOrders.length === 1 ? "" : "s"} ·{" "}
            {selectedTotal.toLocaleString()}
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            action={onClearSelection}
            label="Clear"
            shortcut="c"
          />
        </CommandBar.Bar>
      </CommandBar>
    </div>
  )
}
