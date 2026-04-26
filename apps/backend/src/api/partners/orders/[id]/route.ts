import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getOrderDetailWorkflow } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../helpers"

const DEFAULT_FIELDS = [
  "id", "status", "created_at", "canceled_at", "email",
  "display_id", "custom_display_id", "currency_code", "metadata",
  "total", "credit_line_total", "item_subtotal", "item_total",
  "item_tax_total", "original_item_tax_total", "item_discount_total",
  "shipping_subtotal", "original_total", "original_tax_total",
  "subtotal", "discount_total", "discount_subtotal",
  "shipping_total", "shipping_tax_total", "original_shipping_tax_total",
  "shipping_discount_total", "tax_total", "refundable_total", "order_change",
  "*customer", "*items", "*items.variant", "*items.variant.product",
  "*items.variant.options", "+items.variant.manage_inventory",
  "*items.variant.inventory_items.inventory",
  "+items.variant.inventory_items.required_quantity",
  "+summary", "*shipping_address", "*billing_address",
  "*sales_channel", "*promotions", "*shipping_methods", "*credit_lines",
  "*fulfillments",
  "+fulfillments.shipping_option.service_zone.fulfillment_set.type",
  "*fulfillments.items", "*fulfillments.labels",
  "*payment_collections", "*payment_collections.payments",
  "*payment_collections.payments.refunds",
  "*payment_collections.payments.refunds.refund_reason",
  "region.automatic_taxes",
]

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const { result } = await getOrderDetailWorkflow(req.scope).run({
    input: {
      fields: DEFAULT_FIELDS,
      order_id: req.params.id,
    },
  })

  res.json({ order: result })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const orderService = req.scope.resolve(Modules.ORDER) as any
  const order = await orderService.updateOrders(req.params.id, req.body as any)

  res.json({ order })
}
