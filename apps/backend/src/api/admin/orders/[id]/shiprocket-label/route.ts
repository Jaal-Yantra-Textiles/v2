import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { createShiprocketShipmentForFulfillment } from "../../../../../workflows/orders/shiprocket-shipment"

/**
 * POST /admin/orders/:id/shiprocket-label
 *
 * #404 (#31) PR-C convenience endpoint — one click from the Design Orders UI:
 * create a fulfillment for the whole order (reusing an existing Shiprocket
 * fulfillment if one's already there) and generate the Shiprocket shipment +
 * label off it. Returns the AWB + label URL.
 *
 * Errors (incl. Shiprocket's ShiprocketApiError, a MedusaError #427) surface
 * cleanly to the UI toast.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "items.quantity",
      "fulfillments.id",
      "fulfillments.data",
      "fulfillments.created_at",
    ],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} not found`)
  }

  // Reuse an existing Shiprocket fulfillment if present; else create one for
  // the whole order.
  let fulfillmentId: string | undefined = (order.fulfillments || []).find(
    (f: any) => f.data?.carrier === "shiprocket"
  )?.id

  if (!fulfillmentId) {
    const items = (order.items || []).map((i: any) => ({
      id: i.id,
      quantity: i.quantity,
    }))
    await createOrderFulfillmentWorkflow(req.scope).run({
      input: { order_id: orderId, items },
    })
    // The workflow returns the order; resolve the newest fulfillment by re-query.
    const { data: refetched } = await query.graph({
      entity: "order",
      fields: ["fulfillments.id", "fulfillments.created_at"],
      filters: { id: orderId },
    })
    const fs = (refetched?.[0]?.fulfillments || []) as any[]
    fulfillmentId = fs
      .slice()
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]?.id
  }

  if (!fulfillmentId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Could not resolve a fulfillment to ship for this order"
    )
  }

  const shipment = await createShiprocketShipmentForFulfillment(req.scope, {
    orderId,
    fulfillmentId,
  })

  res.status(200).json({ shiprocket_label: shipment })
}
