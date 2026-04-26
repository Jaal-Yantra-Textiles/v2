import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { FindConfigOrder } from "@medusajs/framework/types"



export const refetchInventoryOrder = async (
  id: string,
  container: MedusaContainer,
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: inventoryItem } = await query.graph({
    entity: "inventory_orders",
    filters: { id },
    fields: [
      "*",
      "orderlines.*",
      "orderlines.inventory_items.*",
    ],
  })

  if (!inventoryItem?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory Order with id "${id}" not found`
    )
  }

  return inventoryItem[0]
}


export const parseOrderParam = (order?: string): FindConfigOrder | undefined => {
    if (!order) return undefined;
    return order.split(',').reduce((acc, part) => {
      const [field, dir] = part.split(':');
      if (field && dir && ["asc", "desc"].includes(dir.toLowerCase())) {
        acc[field.trim()] = dir.toUpperCase() as "ASC" | "DESC";
      }
      return acc;
    }, {} as FindConfigOrder);
  }