import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { Design } from "../../validators"


export type DesignInventoryAllowedFields = "*" | keyof Design

export const refetchDesign = async (
  id: string,
  container: MedusaContainer,
  fields: DesignInventoryAllowedFields[] = ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: design } = await query.graph({
    entity: "design",
    filters: { id },
    fields: [
      "*",
      "inventory_items.*"
    ],
  })

  if (!design?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id "${id}" not found`
    )
  }

  return design[0]
}