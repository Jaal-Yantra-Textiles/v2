import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  createOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Add the GST a design order was placed without, and optionally record what
 * the buyer paid on top as received.
 *
 * 🔴 Prod #148 (2026-10-27): a design-order cart minted with no tax lines was
 * checked out In Person Pickup with no address typed, so checkout never
 * recomputed tax. The order charged ₹2,285.71 with ₹0 GST; the shipping
 * method alone carried its 5% line. The buyer then paid the agreed ₹2,400.
 * Fixed at mint in #2467; this repairs an order placed before it.
 *
 * ## Why the summary is written too
 *
 * Medusa stores an order's `summary` (current total, pending difference) when
 * the order is created and recomputes it only when an order change is applied.
 * A tax line added afterwards raises `order.total` but leaves the summary at
 * the old figure, and a payment recorded against it then reads as an
 * OVERPAYMENT. So the summary's totals are moved to the taxed total, and
 * `pending_difference` becomes what the buyer still owes for it.
 *
 * Refuses an order that is not a design order, a cancelled one, and one whose
 * lines are all taxed already. Preview (default) computes the tax lines and
 * the new totals and writes nothing.
 */

const paramsSchema = z.object({
  order_id: z.string().trim().min(1),
  record_received: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
})

const round2 = (n: number) => Math.round(n * 100) / 100

export const addMissingDesignOrderTaxJob: MaintenanceJob = {
  id: "add-missing-design-order-tax",
  label: "Add the GST a design order was placed without",
  description:
    "Add tax lines to a design order's untaxed lines (checked out before #2467, when an In Person Pickup buyer who typed no address paid no GST — prod #148), and move the order's stored summary to the taxed total so the gap reads as owed, not as an overpayment. `record_received: true` then records that gap as a received payment (the buyer paid the GST-inclusive figure off-platform). REFUSES a non-design order, a cancelled one, and one already fully taxed. Preview (default) writes nothing.",
  params: [
    {
      name: "order_id",
      type: "string",
      required: true,
      description: "The design order (`order_...`)",
    },
    {
      name: "record_received",
      type: "boolean",
      required: false,
      description:
        "Also record the added tax as a received payment (default false). Only when the money really arrived.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_id, record_received } = parsed.data
    const job_id = "add-missing-design-order-tax"

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderModule: any = container.resolve(Modules.ORDER)
    const taxModule: any = container.resolve(Modules.TAX)

    const readOrder = async () =>
      (
        await query.graph({
          entity: "order",
          fields: [
            "id",
            "status",
            "metadata",
            "currency_code",
            "total",
            "tax_total",
            "summary",
            "shipping_address.country_code",
            "shipping_address.province",
            "items.id",
            "items.product_id",
            "items.product_type_id",
            "items.quantity",
            "items.unit_price",
            "items.tax_lines.id",
          ],
          filters: { id: order_id },
        })
      ).data?.[0]

    const order = await readOrder()
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} not found`)
    }

    const refuse = (message: string): MaintenanceJobResult => ({
      job_id,
      dry_run,
      applied: false,
      summary: `REFUSED: ${message}`,
      changes: [],
    })

    if (order.metadata?.source !== "design-order") {
      return refuse("This is not a design order. A storefront order was taxed by its own checkout.")
    }
    if (order.status === "canceled") {
      return refuse("This order is cancelled.")
    }
    const country = String(order.shipping_address?.country_code ?? "").toLowerCase()
    if (!country) {
      return refuse("The order names no country, so no tax region applies.")
    }

    const untaxed = (order.items ?? []).filter((i: any) => !(i.tax_lines ?? []).length)
    if (!untaxed.length) {
      return refuse("Every line on this order already carries tax.")
    }

    const computed: any[] = await taxModule.getTaxLines(
      untaxed.map((i: any) => ({
        id: i.id,
        product_id: i.product_id ?? undefined,
        product_type_id: i.product_type_id ?? undefined,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        currency_code: order.currency_code,
      })),
      { address: { country_code: country, province_code: order.shipping_address?.province ?? null } }
    )
    const itemLines = computed.filter((l: any) => l.line_item_id)
    if (!itemLines.length) {
      return refuse(`No tax rate applies to these lines in "${country}".`)
    }

    const addedTax = round2(
      itemLines.reduce((sum: number, l: any) => {
        const item = untaxed.find((i: any) => i.id === l.line_item_id)
        return sum + (Number(item.unit_price) * Number(item.quantity) * Number(l.rate)) / 100
      }, 0)
    )
    const totalBefore = Number(order.total)
    const totalAfter = round2(totalBefore + addedTax)
    const paid = Number(order.summary?.transaction_total ?? order.summary?.paid_total ?? 0)

    const changes: MaintenanceChange[] = [
      ...itemLines.map((l: any) => ({
        entity: "order_line_item",
        id: l.line_item_id,
        field: "tax_lines",
        before: [],
        after: [{ rate: Number(l.rate), code: l.code, description: l.name }],
      })),
      { entity: "order", id: order_id, field: "total", before: totalBefore, after: totalAfter },
      {
        entity: "order",
        id: order_id,
        field: "summary.pending_difference",
        before: Number(order.summary?.pending_difference ?? 0),
        after: round2(totalAfter - paid),
      },
    ]

    if (dry_run) {
      return {
        job_id,
        dry_run,
        applied: false,
        summary:
          `Would add ${addedTax} ${order.currency_code} tax to ${itemLines.length} line(s): total ${totalBefore} → ${totalAfter}, ` +
          `paid ${paid}, owed ${round2(totalAfter - paid)}` +
          (record_received ? `, then record ${round2(totalAfter - paid)} as received.` : "."),
        changes,
      }
    }

    await orderModule.createOrderLineItemTaxLines(
      order_id,
      itemLines.map((l: any) => ({
        item_id: l.line_item_id,
        rate: l.rate,
        code: l.code,
        description: l.name,
        tax_rate_id: l.rate_id,
        provider_id: l.provider_id,
      }))
    )

    // The stored summary does not follow a tax line added outside an order
    // change; move it to the taxed total (see the header).
    const taxed = await readOrder()
    const newTotal = Number(taxed.total)
    const [summaryRow] = await orderModule.listOrderSummaries({ order_id })
    const totals = { ...(summaryRow?.totals ?? {}) }
    const transactionTotal = Number(totals.transaction_total ?? 0)
    for (const key of ["current_order_total", "original_order_total", "accounting_total"]) {
      totals[key] = newTotal
    }
    totals.pending_difference = round2(newTotal - transactionTotal)
    await orderModule.updateOrderSummaries({ id: summaryRow.id, totals })

    let recorded: number | null = null
    const owed: number = totals.pending_difference
    if (record_received && owed > 0) {
      recorded = owed
      const { result: pc }: any = await createOrderPaymentCollectionWorkflow(container).run({
        input: { order_id, amount: owed },
      })
      const pcId = Array.isArray(pc) ? pc[0]?.id : pc?.id
      await markPaymentCollectionAsPaid(container).run({
        input: { payment_collection_id: pcId, order_id },
      })
      changes.push({
        entity: "payment_collection",
        id: pcId,
        field: "captured",
        before: 0,
        after: recorded,
        note: "The added tax, recorded as received.",
      })
    }

    const after = await readOrder()
    return {
      job_id,
      dry_run,
      applied: true,
      summary:
        `Added ${round2(Number(after.tax_total))} ${order.currency_code} tax: total ${totalBefore} → ${Number(after.total)}, ` +
        `owed now ${Number(after.summary?.pending_difference ?? 0)}` +
        (recorded !== null ? ` (recorded ${recorded} as received).` : "."),
      changes,
    }
  },
}
