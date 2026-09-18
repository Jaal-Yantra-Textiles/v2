import { zodResolver } from "@hookform/resolvers/zod"
import { Button, Heading, Input, Label, Text, toast } from "@medusajs/ui"
import { useMemo } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { DataGrid } from "../../../../components/data-grid"
import { RouteFocusModal, useRouteModal } from "../../../../components/modals"
import { KeyboundForm } from "../../../../components/utilities/keybound-form"
import {
  useProposePartnerInventoryOrderCharge,
  useProposePartnerInventoryOrderLines,
} from "../../../../hooks/api/partner-inventory-orders"
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

  const { mutateAsync: proposeLines, isPending: isPendingLines } =
    useProposePartnerInventoryOrderLines(inventoryOrder.id)
  const { mutateAsync: proposeCharge, isPending: isPendingCharge } =
    useProposePartnerInventoryOrderCharge(inventoryOrder.id)

  // Live totals off the watched form rows (the DataGrid writes on blur).
  const watchedLines = useWatch({ control: form.control, name: "order_lines" })
  const watchedTaxPercent = useWatch({
    control: form.control,
    name: "tax_percent",
  })

  const subtotal = computeSubtotal(watchedLines ?? [])
  const taxPercent = castNumber(watchedTaxPercent ?? "") || 0
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

    const percent = castNumber(data.tax_percent) || 0
    const goodsTotal = computeSubtotal(data.order_lines)
    const tax = Math.round(goodsTotal * percent) / 100

    try {
      await proposeLines({ order_lines })
      if (tax > 0) {
        await proposeCharge({
          type: "tax",
          amount: tax,
          note: `${percent}% tax on goods total`,
        })
      }
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
                Edit quantities and prices, mark lines for removal, and add a
                tax percent on the total. Changes are staged for admin approval.
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
            <div className="flex items-center justify-between gap-x-4">
              <Label htmlFor="tax_percent">Tax percent</Label>
              <div className="relative w-40">
                <Controller
                  control={form.control}
                  name="tax_percent"
                  render={({ field }) => (
                    <Input
                      id="tax_percent"
                      type="number"
                      min={0}
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
              isLoading={isPendingLines || isPendingCharge}
            >
              Save changes
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}