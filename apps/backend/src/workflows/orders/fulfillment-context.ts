import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"

/**
 * #404 / #437 — shared fulfillment plumbing for admin-converted orders.
 *
 * A design order converted via `convert-design-order.ts` is built from
 * TITLE-ONLY line items and is NEVER given a shipping method (the customer
 * never checked out). Medusa core's `createOrderFulfillmentWorkflow` resolves
 * the fulfillment's shipping option as `input.shipping_option_id ??
 * order.shipping_methods[0]?.shipping_option_id` and then reads
 * `shippingOption.provider_id` / `service_zone.fulfillment_set.location.id` off
 * it — so with no shipping method and no explicit option it dereferences a null
 * option and 500s. We therefore resolve a MANUAL shipping option explicitly.
 *
 * Why specifically a MANUAL provider: `createOrderFulfillmentWorkflow` →
 * `createFulfillmentWorkflow` invokes the shipping option's fulfillment-provider
 * `createFulfillment`. The Shiprocket provider's `createFulfillment` CREATES A
 * NEW Shiprocket shipment (service.ts). Creating the plain fulfillment against
 * the manual provider keeps it side-effect-free; carrier data (a fresh AWB, or
 * an existing one) is stamped onto `fulfillment.data` out-of-band afterwards.
 */
export async function resolvePlainFulfillmentContext(
  container: MedusaContainer
): Promise<{ shippingOptionId: string; locationId?: string }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: opts } = await query.graph({
    entity: "shipping_options",
    fields: [
      "id",
      "provider_id",
      "service_zone.fulfillment_set.location.id",
    ],
  })
  const isManual = (o: any) =>
    typeof o?.provider_id === "string" && o.provider_id.startsWith("manual")
  const withLocation = (opts || []).find(
    (o: any) => isManual(o) && o.service_zone?.fulfillment_set?.location?.id
  )
  const anyManual = (opts || []).find(isManual)
  const chosen = withLocation ?? anyManual
  if (!chosen) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "No manual shipping option is configured, so a fulfillment cannot be created for this order. Create a manual shipping option first."
    )
  }
  return {
    shippingOptionId: chosen.id,
    locationId: chosen.service_zone?.fulfillment_set?.location?.id,
  }
}

/**
 * Reuse the order's existing Shiprocket fulfillment if it already has one; else
 * create a plain (manual) fulfillment for the whole order. Returns the
 * fulfillment id. Used by both the "generate new label" and "attach existing
 * AWB" routes.
 */
export async function ensureOrderFulfillment(
  container: MedusaContainer,
  orderId: string,
  opts?: {
    /**
     * Stock location the fulfillment ships from (#772 core-order half). The
     * manual shipping option is still resolved for provider plumbing, but a
     * caller that knows the true ship-from (the partner label route passes
     * the partner's own location) records IT on the fulfillment instead of
     * whatever location the manual option happens to sit on.
     */
    locationId?: string
  }
): Promise<string> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      // Order line-item `quantity` is computed from raw_quantity and does NOT
      // populate when selected by name; read it off the `detail` relation.
      "items.detail.quantity",
      "fulfillments.id",
      "fulfillments.data",
      "fulfillments.created_at",
      "fulfillments.canceled_at",
    ],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} not found`)
  }

  // Reuse an existing fulfillment so a retry (e.g. after a Shiprocket error)
  // doesn't pile up duplicate fulfillments: prefer one already stamped with the
  // Shiprocket carrier, else the most recent non-canceled fulfillment.
  const active = (order.fulfillments || [])
    .filter((f: any) => !f.canceled_at)
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  const existing: string | undefined =
    active.find((f: any) => f.data?.carrier === "shiprocket")?.id ?? active[0]?.id
  if (existing) {
    return existing
  }

  const items = (order.items || []).map((i: any) => ({
    id: i.id,
    quantity: Number(i.detail?.quantity ?? i.quantity) || 1,
  }))
  const { shippingOptionId, locationId } =
    await resolvePlainFulfillmentContext(container)

  await createOrderFulfillmentWorkflow(container).run({
    input: {
      order_id: orderId,
      items,
      shipping_option_id: shippingOptionId,
      location_id: opts?.locationId ?? locationId,
      no_notification: true,
    } as any,
  })

  const { data: refetched } = await query.graph({
    entity: "order",
    fields: ["fulfillments.id", "fulfillments.created_at"],
    filters: { id: orderId },
  })
  const fs = (refetched?.[0]?.fulfillments || []) as any[]
  const fulfillmentId = fs
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]?.id

  if (!fulfillmentId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Could not resolve a fulfillment to ship for this order"
    )
  }
  return fulfillmentId
}
