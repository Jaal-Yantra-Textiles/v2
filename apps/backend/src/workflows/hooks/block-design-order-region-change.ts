import { updateCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

/**
 * A design order's cart cannot change region (#2646).
 *
 * A design order is priced by hand, in one currency, on custom-priced lines
 * (`is_custom_price: true`, see create-draft-order-from-designs.ts). Medusa's
 * `updateCartWorkflow` deletes EVERY custom-priced line when the region
 * changes ("should-delete-line-items"), because the price may no longer fit
 * the new currency. On a design order that is every line: on 2026-11-26 a
 * buyer picked another country at checkout and the ₹ cart became an empty
 * AED cart 84 seconds after it was emailed.
 *
 * `validate` runs before the update and before the line deletion, so refusing
 * here leaves the cart exactly as it was. Only a REGION change is refused: a
 * new shipping address inside the same region still goes through.
 */
export const designOrderRegionChangeMessage = (currencyCode?: string | null) => {
  const currency = String(currencyCode ?? "").trim().toUpperCase()
  return (
    `This order is priced in ${currency || "its original currency"}. ` +
    `To pay in another currency, ask us for a new design order.`
  )
}

updateCartWorkflow.hooks.validate(async ({ input, cart }, { container }) => {
  const currentRegionId = (cart as any)?.region?.id ?? null
  const nextRegionId = (input as any)?.region_id ?? null
  // `input.region_id` is the region the update resolves to: the new one when
  // the request names one, otherwise the cart's own.
  if (!nextRegionId || nextRegionId === currentRegionId) {
    return
  }

  // The workflow's own cart read does not fetch metadata.
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "currency_code", "metadata"],
    filters: { id: (cart as any).id },
  })
  const row = data?.[0]
  if (row?.metadata?.source !== "design-order") {
    return
  }

  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    designOrderRegionChangeMessage(row.currency_code ?? (cart as any)?.region?.currency_code)
  )
})
