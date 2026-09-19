import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"

import {
  buildInventoryOrderInvoiceModel,
  type InventoryOrderInvoiceModel,
  type InvoiceLineInput,
} from "./inventory-order-invoice-model"

/**
 * Read everything an inventory-order proforma needs, in one place.
 *
 * 🔑 ONE gatherer for both surfaces. The partner route and the admin route must
 * produce the byte-identical document — an invoice the partner signs and one
 * the admin files that disagreed on a rate would be worse than having no
 * generator at all. The routes contribute auth and nothing else; this decides
 * what the document says. (Same reasoning as `listPartnerInventoryItemsWorkflow`,
 * where the admin mirror runs the partner's own code rather than a copy.)
 */

/**
 * The HSN lives on the inventory ITEM, the colour and material name on the
 * ORDER LINE (denormalised at creation), and the unit of measure on the RAW
 * MATERIAL. An invoice needs all three, so they are read together.
 */
const ORDER_FIELDS = [
  "id",
  "currency_code",
  "status",
  "order_date",
  "expected_delivery_date",
  "metadata",
  "total_price",
  "orderlines.id",
  "orderlines.quantity",
  "orderlines.price",
  "orderlines.extra_cost",
  "orderlines.color",
  "orderlines.material_name",
  "orderlines.inventory_items.id",
  "orderlines.inventory_items.sku",
  "orderlines.inventory_items.title",
  "orderlines.inventory_items.hs_code",
  "orderlines.inventory_items.raw_materials.unit_of_measure",
  "partner.id",
  "partner.name",
  "partner.tax_id",
  "partner.tax_id_type",
  "partner.country_code",
  "to_stock_location.id",
  "to_stock_location.name",
  "to_stock_location.address.*",
]

const addressLines = (address: any): string[] => {
  if (!address) return []
  return [
    address.address_1,
    address.address_2,
    [address.city, address.province].filter(Boolean).join(", "),
    [address.country_code ? String(address.country_code).toUpperCase() : null, address.postal_code]
      .filter(Boolean)
      .join(" "),
    address.phone ? `Tel: ${address.phone}` : null,
  ]
}

export const gatherInventoryOrderInvoice = async (
  container: MedusaContainer,
  orderId: string,
  options: { issuedOn?: Date } = {}
): Promise<InventoryOrderInvoiceModel> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "inventory_orders",
    fields: ORDER_FIELDS,
    filters: { id: orderId },
  })

  const order = data?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${orderId} not found`
    )
  }

  /**
   * ⚠️ Charges are read through the module service, not the graph. They decide
   * the grand total, and a relation name that silently resolves to nothing
   * would print an invoice missing its tax with no error anywhere — a wrong
   * response key reads as a confident nothing.
   */
  const service: any = container.resolve(ORDER_INVENTORY_MODULE)
  const charges = await service.listOrderCharges({ inventory_orders_id: orderId })

  const lines: InvoiceLineInput[] = ((order as any).orderlines ?? [])
    .filter((line: any) => line && !line.deleted_at)
    .map((line: any) => {
      const item = Array.isArray(line.inventory_items)
        ? line.inventory_items[0]
        : line.inventory_items
      const rawMaterial = Array.isArray(item?.raw_materials)
        ? item?.raw_materials[0]
        : item?.raw_materials
      return {
        material_name: line.material_name,
        color: line.color,
        item_title: item?.title,
        sku: item?.sku,
        hs_code: item?.hs_code,
        unit_of_measure: rawMaterial?.unit_of_measure,
        quantity: line.quantity,
        price: line.price,
        extra_cost: line.extra_cost,
      }
    })

  const partner = Array.isArray((order as any).partner)
    ? (order as any).partner[0]
    : (order as any).partner

  const destination = (order as any).to_stock_location

  return buildInventoryOrderInvoiceModel({
    order: order as any,
    lines,
    charges: (charges ?? []) as any,
    supplier: partner ?? null,
    billTo: {
      name: destination?.name || "Jaal Yantra Textiles",
      lines: addressLines(destination?.address),
    },
    issuedOn: options.issuedOn,
  })
}
