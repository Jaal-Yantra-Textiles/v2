import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { DataGrid } from "../../../../components/data-grid"
import { RouteFocusModal, useRouteModal } from "../../../../components/modals"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import { usePartnerUpdateInventoryOrderLines } from "../../../../hooks/api/partner-inventory-orders"
import { castNumber } from "../../../../lib/cast-number"
import { getStylizedAmount } from "../../../../lib/money-amount-helpers"
import {
  EditInventoryOrderLinesSchema,
  EditInventoryOrderLinesSchemaType,
  OrderLineRow,
} from "./schema"
import { useInventoryOrderEditColumns } from "./use-inventory-order-edit-columns"

type InventoryOrderEditFormProps = {
  inventoryOrder: Record<string, any>
  currencyCode: string
}

const resolveRow = (line: Record<string, any>): OrderLineRow => {
  const item = line?.inventory_items?.[0]
  const title =
    line?.material_name ||
    item?.title ||
    item?.name ||
    line?.inventory_item_id ||
    line?.id ||
    ""
  return {
    id: line.id,
    title,
    sku: item?.sku ?? null,
    quantity: Number(line.quantity) || 0,
    price: Number(line.price) || 0,
    extra_cost: Number(line.extra_cost) || 0,
    remove: false,
  }
}

// A removed line contributes nothing; a kept line is (price + extra_cost) × qty.
const computeSubtotal = (
  lines: Array<Record<string, any> | undefined>
): number =>
  (lines ?? []).reduce((sum, l) => {
    if (!l || l.remove) {
      return sum
    }
    return (
      sum +
      (castNumber(l.price ?? 0) + castNumber(l.extra_cost ?? 0)) *
        castNumber(l.quantity ?? 0)
    )
  }, 0)

export const InventoryOrderEditForm = ({
  inventoryOrder,
  currencyCode,
}: InventoryOrderEditFormProps) => {
  const { handleSuccess, setCloseOnEscape } = useRouteModal()

  const rows = useMemo<OrderLineRow[]>(
    () => (inventoryOrder.order_lines ?? []).map(resolveRow),
    [inventoryOrder.order_lines]
  )

  const form = useForm<EditInventoryOrderLinesSchemaType>({
    defaultValues: {
      order_lines: rows.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        price: r.price,
        extra_cost: r.extra_cost,
        remove: false,
      })),
      tax_percent: "",
    },
    resolver: zodResolver(EditInventoryOrderLinesSchema),
  })

  const columns = useInventoryOrderEditColumns(currencyCode)

  /**
   * ONE call, not two (#1752). Lines and the tax used to be staged separately:
   * a failure between them left a proposal an admin would read as complete and
   * untaxed, with the partner shown an error. The route now takes both.
   */
  const { mutateAsync: proposeLines, isPending: isPendingLines } =
    usePartnerUpdateInventoryOrderLines(inventoryOrder.id)

  // Live totals off the watched form rows (the DataGrid writes on blur).
  const watchedLines = useWatch({ control: form.control, name: "order_lines" })
  const watchedTaxPercent = useWatch({
    control: form.control,
    name: "tax_percent",
  })

  const rowCount = (watchedLines ?? []).length
  const removedCount = (watchedLines ?? []).filter((l) => l?.remove).length
  /**
   * 🔴 Every row ticked would leave the order with no goods on it. The schema
   * refuses it and so does the route (`removesEveryLine`); this only stops the
   * partner reaching a refusal they can see coming.
   */
  const removesEverything = rowCount > 0 && removedCount === rowCount

  const subtotal = computeSubtotal(watchedLines ?? [])
  /**
   * 🔑 Blank is NOT zero. The form does not load a tax proposed earlier, so a
   * blank field means "unknown — leave whatever is staged alone". Only a typed
   * value is authoritative, and a typed `0` withdraws the staged tax.
   */
  const taxStated = String(watchedTaxPercent ?? "").trim() !== ""
  const taxPercent = taxStated ? castNumber(watchedTaxPercent) || 0 : 0
  const taxAmount = Math.round(subtotal * taxPercent) / 100
  const total = subtotal + taxAmount

  const money = (amount: number) => getStylizedAmount(amount, currencyCode)

  const onSubmit = form.handleSubmit(async (data) => {
    const order_lines = data.order_lines.map((line) =>
      line.remove
        ? { id: line.id, remove: true }
        : {
            id: line.id,
            quantity: castNumber(line.quantity),
            price: castNumber(line.price),
            extra_cost: castNumber(line.extra_cost),
          }
    )

    const stated = String(data.tax_percent ?? "").trim() !== ""
    const percent = stated ? castNumber(data.tax_percent) || 0 : 0
    const goodsTotal = computeSubtotal(data.order_lines)
    const tax = Math.round(goodsTotal * percent) / 100

    /**
     * 🔴 Sent whenever a percent was STATED, including 0.
     *
     * The old guard only posted when the tax was positive, so a 0 left an
     * earlier proposal's tax staged while this screen showed none — and a
     * negative percent showed a reduced total and proposed nothing at all. The
     * backend now replaces a charge by type and treats 0 as a withdrawal, so
     * what the footer shows is what the admin sees.
     *
     * A blank field sends nothing, because the form cannot see a tax proposed
     * earlier and must not withdraw one it never displayed.
     */
    const charges = stated
      ? [
          tax > 0
            ? { type: "tax" as const, amount: tax, note: `${percent}% tax on goods total` }
            : { type: "tax" as const, amount: 0 },
        ]
      : undefined

    try {
      await proposeLines({ order_lines, ...(charges ? { charges } : {}) })
      toast.success("Changes proposed — awaiting admin approval")
      handleSuccess()
    } catch (error) {
      toast.error((error as Error).message || "Failed to save changes")
    }
  })

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex size-full flex-col">
        <RouteFocusModal.Header>
          <RouteFocusModal.Title asChild>
            <Heading>Edit order lines</Heading>
          </RouteFocusModal.Title>
          <RouteFocusModal.Description className="sr-only">
            Propose changes to the order lines and tax
          </RouteFocusModal.Description>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex size-full flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                Edit quantities and prices, tick Remove to take a line off the
                order, and add a tax percent on the total. Quantities may be
                decimal — 12.5 m is a valid length. Nothing is applied: your
                changes are staged for an admin to approve.
              </Text>
            </div>
            <DataGrid
              columns={columns}
              data={rows}
              state={form}
              onEditingChange={(editing) => setCloseOnEscape(!editing)}
            />
          </div>

          {/* Tax percent + live totals */}
          <div className="flex flex-col gap-y-3 border-t px-6 py-4">
            {removedCount > 0 && (
              <Text
                size="small"
                className={
                  removesEverything ? "text-ui-fg-error" : "text-ui-fg-subtle"
                }
                data-testid="inv-change-removal-summary"
              >
                {removesEverything
                  ? "This removes every line, which would leave the order empty. Keep at least one line, or ask for the order to be cancelled."
                  : `${removedCount} of ${rowCount} lines marked for removal. They are dropped from the order once an admin approves; a line that has already been received cannot be removed.`}
              </Text>
            )}
            <div className="flex items-center justify-between gap-x-4">
              <div className="flex flex-col">
                <Label htmlFor="tax_percent">Tax percent</Label>
                {/* Blank is not zero — see the submit handler. */}
                <Text size="small" className="text-ui-fg-subtle">
                  Leave blank to keep any tax proposed earlier. Enter 0 to remove it.
                </Text>
              </div>
              <div className="relative w-40">
                <Controller
                  control={form.control}
                  name="tax_percent"
                  render={({ field }) => (
                    <Input
                      id="tax_percent"
                      data-testid="inv-change-tax-percent"
                      type="number"
                      min={0}
                      max={100}
                      placeholder="0"
                      value={field.value}
                      onChange={field.onChange}
                      className="pr-6 text-right"
                    />
                  )}
                />
                <span className="text-ui-fg-subtle pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
                  %
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center justify-between">
                <Text size="small" className="text-ui-fg-subtle">
                  Goods total
                </Text>
                <Text size="small">{money(subtotal)}</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text size="small" className="text-ui-fg-subtle">
                  Tax ({taxPercent}%)
                </Text>
                <Text size="small">{money(taxAmount)}</Text>
              </div>
              <div className="flex items-center justify-between">
                <Text size="small" weight="plus">
                  Total
                </Text>
                <Text size="small" weight="plus">
                  {money(total)}
                </Text>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small" type="button">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              type="submit"
              size="small"
              data-testid="inv-change-submit"
              isLoading={isPendingLines}
              disabled={removesEverything}
            >
              Propose changes
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}