import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { retrieveShipmentDetailsStep } from "../steps/retrieve-shipment-details"
import { sendNotificationEmailWorkflow } from "./send-notification-email"
import type { SendShipmentStatusEmailInput, ShipmentStatusVariant } from "../types"

const SHIPMENT_TEMPLATE_CONFIG: Record<
  ShipmentStatusVariant,
  {
    templateKey: string
    statusCopy: string
    badgeColor: string
  }
> = {
  shipped: {
    templateKey: "order-shipment-created",
    statusCopy: "Your items are on the way. Track the package below.",
    badgeColor: "bg-sky-600",
  },
  delivered: {
    templateKey: "order-shipment-delivered",
    statusCopy: "Your parcel was delivered. Let us know if anything looks off.",
    badgeColor: "bg-emerald-600",
  },
}

export const sendShipmentStatusEmail = createWorkflow(
  { name: "send-shipment-status-email", store: true },
  (input: SendShipmentStatusEmailInput) => {
    const shipmentData = retrieveShipmentDetailsStep({
      shipment_id: input.shipment_id,
    })

    const emailInput = transform({ shipmentData, input }, ({ shipmentData, input }) => {
      const config = SHIPMENT_TEMPLATE_CONFIG[input.status] ?? SHIPMENT_TEMPLATE_CONFIG.shipped

      const trackingLinks = shipmentData.trackingLinks || []
      const trackingNumbers = shipmentData.trackingNumbers || []
      const formattedItems = (shipmentData.items || []).map((item: any) => ({
        id: item.id,
        title: item.title || "Item",
        sku: item.sku,
        quantity: item.quantity,
      }))

      return {
        to: shipmentData.customer_email,
        template: config.templateKey,
        data: {
          customer_name: shipmentData.customer_name,
          status_copy: config.statusCopy,
          status_badge_class: config.badgeColor,
          order_id: shipmentData.order.display_id || shipmentData.order.id,
          order_date: shipmentData.order.created_at,
          fulfillment_id: shipmentData.fulfillment.id,
          shipment_status: input.status,
          tracking_numbers: trackingNumbers,
          tracking_links: trackingLinks,
          items: formattedItems,
          shipping_address: shipmentData.shippingAddress,
          order_totals: {
            subtotal: shipmentData.order.subtotal,
            shipping_total: shipmentData.order.shipping_total,
            tax_total: shipmentData.order.tax_total,
            total: shipmentData.order.total,
            currency_code: shipmentData.order.currency_code,
          },
        },
      }
    })

    const result = sendNotificationEmailWorkflow.runAsStep({
      input: emailInput,
    })

    return new WorkflowResponse(result)
  }
)
