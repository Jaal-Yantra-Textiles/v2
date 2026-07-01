import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import RawMaterialInventoryLink from "../../../links/raw-material-data-inventory"

/**
 * Fetch a raw_material_group together with its per-color raw_materials (the
 * "variants"), the shared material_type, and each color's linked inventory_item
 * (id/sku). Powers the group detail + the group-ordering UI.
 *
 * The color→inventory_item info is attached via a second query over the
 * raw_material↔inventory_item LINK entity (the proven direction — there is no
 * nested raw_material→inventory_item graph path), so this stays deterministic.
 */
export const refetchRawMaterialGroup = async (
  id: string,
  container: MedusaContainer
) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "raw_material_group",
    filters: { id },
    fields: [
      "*",
      "material_type.*",
      "raw_materials.id",
      "raw_materials.name",
      "raw_materials.color",
      "raw_materials.status",
    ],
  })

  if (!data?.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${id}" not found`
    )
  }

  const group: any = data[0]
  const colors: any[] = group.raw_materials ?? []

  if (colors.length) {
    const rawMaterialIds = colors.map((c) => c.id).filter(Boolean)
    const { data: linkRows } = await query.graph({
      entity: RawMaterialInventoryLink.entryPoint,
      fields: ["raw_materials.id", "inventory_item.id", "inventory_item.sku"],
      filters: { raw_materials_id: rawMaterialIds },
    })
    const itemByRawMaterialId = new Map<string, { id: string; sku?: string }>()
    for (const row of (linkRows as any[]) ?? []) {
      const rmId = row?.raw_materials?.id
      const item = row?.inventory_item
      if (rmId && item?.id && !itemByRawMaterialId.has(rmId)) {
        itemByRawMaterialId.set(rmId, { id: item.id, sku: item.sku })
      }
    }
    group.raw_materials = colors.map((c) => ({
      ...c,
      inventory_item: itemByRawMaterialId.get(c.id) ?? null,
    }))
  }

  return group
}
