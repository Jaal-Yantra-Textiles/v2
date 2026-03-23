import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createInventoryItemsWorkflow, createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { createRawMaterialWorkflow } from "../../../../workflows/raw-materials/create-raw-material"
import { BulkImportInput } from "./validators"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as BulkImportInput

  // Resolve stock location
  let stockLocationId = body.stock_location_id
  if (!stockLocationId) {
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "stock_location",
        fields: ["id"],
      })
      stockLocationId =
        Array.isArray(data) && data.length ? data[0].id : undefined
    } catch {
      // best-effort
    }
  }

  const results: any[] = []
  const errors: { index: number; name: string; error: string }[] = []

  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i]
    try {
      // 1) Create inventory item
      const { result: created } = await createInventoryItemsWorkflow(
        req.scope
      ).run({
        input: {
          items: [
            {
              title: item.name,
              description: item.description || undefined,
            },
          ],
        },
      })

      const createdItems: any[] =
        (created as any)?.items || (created as any) || []
      if (!createdItems.length) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Failed to create inventory item"
        )
      }
      const inventoryItem = createdItems[0]

      // 2) Create inventory level if location available
      if (stockLocationId) {
        try {
          await createInventoryLevelsWorkflow(req.scope).run({
            input: {
              inventory_levels: [
                {
                  inventory_item_id: inventoryItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: 0,
                  incoming_quantity: 0,
                },
              ],
            },
          })
        } catch {
          // non-fatal - continue without level
        }
      }

      // 3) Create raw material + link
      const rawMaterialData: Record<string, any> = {
        name: item.name,
        description: item.description || "",
        composition: item.composition || "",
        unit_of_measure: item.unit_of_measure || "Other",
      }
      if (item.color) rawMaterialData.color = item.color
      if (item.material_type)
        rawMaterialData.material_type = item.material_type
      if (item.media && item.media.length > 0) {
        rawMaterialData.media = { files: item.media }
      }

      const { result: rawResult } = await createRawMaterialWorkflow(
        req.scope
      ).run({
        input: {
          inventoryId: inventoryItem.id,
          rawMaterialData,
        },
      })

      results.push({
        inventory_item: inventoryItem,
        raw_material: (rawResult as any)?.rawMaterial || rawResult,
      })
    } catch (e: any) {
      errors.push({
        index: i,
        name: item.name,
        error: e?.message || "Unknown error",
      })
    }
  }

  return res.status(201).json({
    message: `Created ${results.length} of ${body.items.length} items`,
    created: results,
    errors,
  })
}
