import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { RAW_MATERIAL_MODULE } from "../../../modules/raw_material"
import RawMaterialService from "../../../modules/raw_material/service"
import { buildSkuPrefix, formatSku, nextSequenceNumber } from "../../../utils/generate-sku"
import { IInventoryService } from "@medusajs/types"

type GenerateSkuInput = {
  inventoryId: string
  rawMaterialId: string
}

export const generateSkuStep = createStep(
  "generate-sku-for-inventory-item",
  async (input: GenerateSkuInput, { container }) => {
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Check if inventory item already has a SKU
    const inventoryItem = await inventoryService.retrieveInventoryItem(input.inventoryId)
    if (inventoryItem.sku) {
      return new StepResponse(
        { sku: inventoryItem.sku, skipped: true },
        null as string | null
      )
    }

    // Retrieve the raw material with its material_type
    const rawMaterial = await rawMaterialService.retrieveRawMaterial(input.rawMaterialId, {
      relations: ["material_type"],
    })

    const category = (rawMaterial as any).material_type?.category || "Other"
    const materialName = rawMaterial.name
    const color = (rawMaterial as any).color || null

    // Build SKU prefix
    const prefix = buildSkuPrefix(category, materialName, color)

    // Find existing inventory items whose SKU starts with this prefix
    const { data: existingItems } = await query.graph({
      entity: "inventory_item",
      fields: ["sku"],
      filters: {
        sku: { $like: `${prefix}-%` },
      },
    })

    const existingSkus = existingItems
      .map((item: any) => item.sku)
      .filter(Boolean) as string[]

    const seq = nextSequenceNumber(existingSkus, prefix)
    const sku = formatSku(prefix, seq)

    // Set SKU on the inventory item
    await inventoryService.updateInventoryItems({ id: input.inventoryId, sku })

    return new StepResponse(
      { sku, skipped: false },
      input.inventoryId as string | null
    )
  },
  async (inventoryId, { container }) => {
    if (!inventoryId) return
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    await inventoryService.updateInventoryItems({
      id: inventoryId,
      sku: undefined as any,
    })
  }
)
