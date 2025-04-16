import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"




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
      'orderlines.inventory_item.*.*',
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