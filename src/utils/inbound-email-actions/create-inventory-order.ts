import { MedusaContainer } from "@medusajs/framework/types"
import { InboundEmailAction, InboundEmailRecord, registerAction } from "./index"
import { parseOrderEmail, ExtractedOrderData } from "../parse-order-email"
import { createInventoryOrderWorkflow } from "../../workflows/inventory_orders/create-inventory-orders"

export interface CreateInventoryOrderParams {
  stock_location_id: string
  from_stock_location_id?: string
  item_mappings: Array<{
    extracted_item_index: number
    inventory_item_id: string
    quantity: number
    price: number
  }>
}

const createInventoryOrderAction: InboundEmailAction = {
  type: "create_inventory_order",
  label: "Create Inventory Order",
  description: "Parse order confirmation email and create an inventory order with line items",

  async extract(email: InboundEmailRecord): Promise<ExtractedOrderData> {
    return parseOrderEmail(email.html_body, email.from_address)
  },

  async execute(
    email: InboundEmailRecord,
    extractedData: ExtractedOrderData,
    params: CreateInventoryOrderParams,
    container: MedusaContainer
  ): Promise<any> {
    const orderLines = params.item_mappings.map((mapping) => ({
      inventory_item_id: mapping.inventory_item_id,
      quantity: mapping.quantity,
      price: mapping.price,
    }))

    const totalPrice = orderLines.reduce((sum, l) => sum + l.price * l.quantity, 0)
    const totalQuantity = orderLines.reduce((sum, l) => sum + l.quantity, 0)

    const { result, errors } = await createInventoryOrderWorkflow(container).run({
      input: {
        order_lines: orderLines,
        quantity: totalQuantity,
        total_price: totalPrice,
        status: "Pending",
        expected_delivery_date: extractedData.estimated_delivery
          ? new Date(extractedData.estimated_delivery)
          : undefined,
        order_date: extractedData.order_date
          ? new Date(extractedData.order_date)
          : new Date(),
        shipping_address: {},
        stock_location_id: params.stock_location_id,
        from_stock_location_id: params.from_stock_location_id,
        is_sample: false,
        metadata: {
          source: "inbound_email",
          inbound_email_id: email.id,
          vendor: extractedData.vendor,
          order_number: extractedData.order_number,
        },
      },
    })

    if (errors.length > 0) {
      throw new Error(`Workflow errors: ${errors.map((e: any) => e.message || e).join(", ")}`)
    }

    return {
      inventory_order_id: result.order.id,
      order_lines_count: orderLines.length,
    }
  },
}

registerAction(createInventoryOrderAction)

export default createInventoryOrderAction
