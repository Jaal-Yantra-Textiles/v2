import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export const retrieveShipmentDetailsStep = createStep(
  { name: "retrieve-shipment-details", store: true },
  async ({ shipment_id }: { shipment_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "labels.tracking_number",
        "labels.tracking_url",
        "labels.label_url",
        "items.id",
        "items.title",
        "items.quantity",
        "items.sku",
        "order.id",
        "order.display_id",
        "order.email",
        "order.currency_code",
        "order.created_at",
        "order.subtotal",
        "order.shipping_total",
        "order.tax_total",
        "order.total",
        "order.shipping_address.first_name",
        "order.shipping_address.last_name",
        "order.shipping_address.address_1",
        "order.shipping_address.address_2",
        "order.shipping_address.city",
        "order.shipping_address.postal_code",
        "order.shipping_address.country_code",
        "order.shipping_address.phone",
      ],
      filters: { id: shipment_id },
    })

    const fulfillment = data?.[0]

    if (!fulfillment) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Fulfillment with id "${shipment_id}" was not found`
      )
    }

    const order = fulfillment.order

    if (!order) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Fulfillment "${shipment_id}" is not linked to an order`
      )
    }

    const shippingAddress = order.shipping_address || null
    const customerEmail = order.email || ""
    const customerName =
      shippingAddress?.first_name || shippingAddress?.last_name
        ? `${shippingAddress?.first_name || ""} ${shippingAddress?.last_name || ""}`.trim()
        : customerEmail || "Customer"

    const labels = Array.isArray(fulfillment.labels) ? fulfillment.labels : []
    const trackingNumbers = labels
      .map((label: any) => label?.tracking_number)
      .filter(Boolean)

    const trackingLinks = labels
      .map((label: any) => {
        const trackingUrl = label?.tracking_url || label?.label_url
        if (!trackingUrl) {
          return null
        }

        return {
          url: trackingUrl,
          label: label?.tracking_number || "Track shipment",
        }
      })
      .filter(Boolean)

    return new StepResponse({
      fulfillment,
      order,
      shippingAddress,
      items: fulfillment.items || [],
      customer_email: customerEmail,
      customer_name: customerName,
      trackingNumbers,
      trackingLinks,
    })
  }
)
