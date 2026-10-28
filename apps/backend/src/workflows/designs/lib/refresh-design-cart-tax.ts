import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateTaxLinesWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Recompute a design-order cart's tax lines, and read back what it now owes.
 *
 * 🔴 A design-order cart is built through the cart MODULE (createCarts +
 * addLineItems), which writes no tax lines. Medusa only recomputes them when a
 * cart update changes a tax-relevant address field (country, province,
 * postcode, city, address id — `update-cart.ts` `taxRelevantAddressChanged`).
 * The cart is minted already carrying the buyer's country, so a buyer who
 * changes nothing — In Person Pickup, no address typed — checks out with the
 * design line UNTAXED while the shipping method (taxed when it is added) shows
 * GST. Seen on prod order #148 (2026-10-27): ₹2,285.71 charged, ₹0 GST.
 *
 * Call this after anything that writes a design-order cart's items, price or
 * country through the module service. A cart with no country gets no tax lines
 * (the tax module finds no region) — harmless, and checkout's address update
 * then refreshes them as before.
 */
export async function refreshDesignCartTax(
  container: any,
  cartId: string
): Promise<{ tax_total: number; total: number }> {
  await updateTaxLinesWorkflow(container).run({ input: { cart_id: cartId } })

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "tax_total", "total"],
    filters: { id: cartId },
  })
  return {
    tax_total: Number(data?.[0]?.tax_total ?? 0),
    total: Number(data?.[0]?.total ?? 0),
  }
}
