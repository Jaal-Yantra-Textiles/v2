import { MedusaContainer } from "@medusajs/framework/types"
import { RAW_MATERIAL_MODULE } from "../../../../../modules/raw_material"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { RawMaterial } from "./validators"
import RawMaterialInventoryLink from "../../../../../links/raw-material-data-inventory"

export type RawMaterialAllowedFields = "*" | keyof RawMaterial

export const refetchRawMaterial = async (
  id: string,
  container: MedusaContainer,
  fields: RawMaterialAllowedFields[] = ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: inventoryItem } = await query.graph({
    entity: "inventory_item",
    filters: { id },
    fields: [
      "*",
      "raw_materials.*",
    ],
  })

  if (!inventoryItem?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw Material with id "${id}" not found`
    )
  }

  return inventoryItem[0]
}

export const getAllInventoryWithRawMaterial = async (
  container: MedusaContainer,
  filters: Record<string, unknown> = {},
  fields: RawMaterialAllowedFields[] = ["*"]
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: RawMaterialInventoryLink.entryPoint,
    fields: ["*", "raw_materials.*", "inventory_item.*"],
    filters
  })
  return data
}