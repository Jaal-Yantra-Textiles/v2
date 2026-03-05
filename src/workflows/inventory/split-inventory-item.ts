import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createRawMaterialWorkflow } from "../raw-materials/create-raw-material"

export type SplitInventoryItemInput = {
  sourceInventoryItemId: string
  quantity: number
  newTitle: string
  rawMaterialOverrides?: {
    name?: string
    color?: string
    composition?: string
    grade?: string
    description?: string
    extra?: Record<string, string>
  }
}

type SourceData = {
  item: {
    id: string
    title: string
    requires_shipping: boolean
    sku?: string
  }
  levels: Array<{
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }>
  rawMaterial: {
    id: string
    name: string
    composition?: string
    color?: string
    grade?: string
    description?: string
    specifications?: Record<string, any>
    material_type_id?: string
  } | null
  splitPortions: Array<{
    location_id: string
    levelId: string
    sourceInventoryItemId: string
    portion: number
    newSourceQuantity: number
  }>
}

const getSourceDataStep = createStep(
  "get-source-data-step",
  async (
    input: { sourceInventoryItemId: string; quantity: number },
    { container }
  ) => {
    const inventoryService = container.resolve(Modules.INVENTORY)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get inventory item
    let item: any
    try {
      item = await (inventoryService as any).retrieveInventoryItem(
        input.sourceInventoryItemId
      )
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory item ${input.sourceInventoryItemId} not found`
      )
    }

    // Get levels
    const levels = await (inventoryService as any).listInventoryLevels({
      inventory_item_id: input.sourceInventoryItemId,
    })

    if (!levels || levels.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Source inventory item has no stock levels"
      )
    }

    const totalStocked = levels.reduce(
      (sum: number, l: any) => sum + (Number(l.stocked_quantity) || 0),
      0
    )

    if (input.quantity > totalStocked) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cannot split ${input.quantity} units — only ${totalStocked} stocked`
      )
    }

    if (input.quantity <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Quantity must be a positive integer"
      )
    }

    // Get linked raw material via query graph
    let rawMaterial: any = null
    try {
      const { data } = await query.graph({
        entity: "inventory_item",
        fields: [
          "id",
          "raw_materials.id",
          "raw_materials.name",
          "raw_materials.composition",
          "raw_materials.color",
          "raw_materials.grade",
          "raw_materials.description",
          "raw_materials.specifications",
          "raw_materials.material_type_id",
          "raw_materials.material_type.*",
        ],
        filters: { id: input.sourceInventoryItemId },
      })
      const found = Array.isArray(data) ? data[0] : data
      rawMaterial = found?.raw_materials ?? null
    } catch (_e) {
      // No raw material linked — that's fine
    }

    // Compute proportional split portions
    const qty = input.quantity
    const sortedLevels = [...levels].sort(
      (a: any, b: any) =>
        (Number(b.stocked_quantity) || 0) - (Number(a.stocked_quantity) || 0)
    )

    let remaining = qty
    const portions: SourceData["splitPortions"] = []

    for (let i = 0; i < sortedLevels.length; i++) {
      const lvl = sortedLevels[i]
      const stocked = Number(lvl.stocked_quantity) || 0
      const isLast = i === sortedLevels.length - 1

      let portion: number
      if (isLast) {
        portion = remaining
      } else {
        portion = Math.min(Math.floor((qty * stocked) / totalStocked), remaining)
      }

      portions.push({
        location_id: lvl.location_id,
        levelId: lvl.id,
        sourceInventoryItemId: input.sourceInventoryItemId,
        portion,
        newSourceQuantity: stocked - portion,
      })

      remaining -= portion
      if (remaining <= 0) {
        // Fill remaining locations with 0 split
        for (let j = i + 1; j < sortedLevels.length; j++) {
          const l = sortedLevels[j]
          portions.push({
            location_id: l.location_id,
            levelId: l.id,
            sourceInventoryItemId: input.sourceInventoryItemId,
            portion: 0,
            newSourceQuantity: Number(l.stocked_quantity) || 0,
          })
        }
        break
      }
    }

    const sourceData: SourceData = {
      item: {
        id: item.id,
        title: item.title,
        requires_shipping: item.requires_shipping ?? true,
        sku: item.sku,
      },
      levels,
      rawMaterial,
      splitPortions: portions,
    }

    return new StepResponse(sourceData)
  }
)

const createSplitInventoryItemStep = createStep(
  "create-split-inventory-item-step",
  async (
    input: { title: string; requires_shipping: boolean },
    { container }
  ) => {
    const inventoryService = container.resolve(Modules.INVENTORY)
    const [newItem] = await (inventoryService as any).createInventoryItems([
      {
        title: input.title,
        requires_shipping: input.requires_shipping,
      },
    ])
    return new StepResponse(newItem, newItem.id)
  },
  async (newItemId: string, { container }) => {
    if (!newItemId) return
    const inventoryService = container.resolve(Modules.INVENTORY)
    await (inventoryService as any).deleteInventoryItems([newItemId])
  }
)

const createSplitInventoryLevelsStep = createStep(
  "create-split-inventory-levels-step",
  async (
    input: {
      levels: Array<{
        inventory_item_id: string
        location_id: string
        stocked_quantity: number
      }>
    },
    { container }
  ) => {
    if (!input.levels.length) return new StepResponse([], [])
    const inventoryService = container.resolve(Modules.INVENTORY)
    const created = await (inventoryService as any).createInventoryLevels(
      input.levels
    )
    const ids = (Array.isArray(created) ? created : [created]).map(
      (l: any) => l.id
    )
    return new StepResponse(created, ids)
  },
  async (levelIds: string[], { container }) => {
    if (!levelIds || !levelIds.length) return
    const inventoryService = container.resolve(Modules.INVENTORY)
    await (inventoryService as any).deleteInventoryLevels(levelIds)
  }
)

type LevelUpdate = {
  id: string
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
}

const decrementSourceLevelsStep = createStep(
  "decrement-source-levels-step",
  async (
    input: {
      updates: LevelUpdate[]
      originals: LevelUpdate[]
    },
    { container }
  ) => {
    if (!input.updates.length) return new StepResponse(null, input.originals)
    const inventoryService = container.resolve(Modules.INVENTORY)
    await (inventoryService as any).updateInventoryLevels(input.updates)
    return new StepResponse(null, input.originals)
  },
  async (originals: LevelUpdate[], { container }) => {
    if (!originals || !originals.length) return
    const inventoryService = container.resolve(Modules.INVENTORY)
    await (inventoryService as any).updateInventoryLevels(originals)
  }
)

export const splitInventoryItemWorkflow = createWorkflow(
  "split-inventory-item",
  (input: SplitInventoryItemInput) => {
    // Step 1: Validate and get source data
    const sourceData = getSourceDataStep({
      sourceInventoryItemId: input.sourceInventoryItemId,
      quantity: input.quantity,
    })

    // Step 2: Create new inventory item
    const newItemInput = transform({ sourceData, input }, ({ sourceData, input }) => ({
      title: input.newTitle,
      requires_shipping: sourceData.item.requires_shipping,
    }))
    const newItem = createSplitInventoryItemStep(newItemInput)

    // Step 3: Create inventory levels for new item
    const levelsInput = transform(
      { sourceData, newItem },
      ({ sourceData, newItem }) => ({
        levels: sourceData.splitPortions
          .filter((p) => p.portion > 0)
          .map((p) => ({
            inventory_item_id: (newItem as any).id,
            location_id: p.location_id,
            stocked_quantity: p.portion,
          })),
      })
    )
    createSplitInventoryLevelsStep(levelsInput)

    // Step 4: Decrement source levels
    const decrementInput = transform({ sourceData }, ({ sourceData }) => ({
      updates: sourceData.splitPortions
        .filter((p) => p.portion > 0)
        .map((p) => ({
          id: p.levelId,
          inventory_item_id: p.sourceInventoryItemId,
          location_id: p.location_id,
          stocked_quantity: p.newSourceQuantity,
        })),
      originals: sourceData.splitPortions.map((p) => ({
        id: p.levelId,
        inventory_item_id: p.sourceInventoryItemId,
        location_id: p.location_id,
        stocked_quantity: p.newSourceQuantity + p.portion,
      })),
    }))
    decrementSourceLevelsStep(decrementInput)

    // Step 5: Create raw material linked to new item
    const rawMaterialInput = transform(
      { sourceData, newItem, input },
      ({ sourceData, newItem, input }) => {
        const src = sourceData.rawMaterial
        const overrides = input.rawMaterialOverrides ?? {}
        const { extra = {}, ...rest } = overrides

        // Merge extra into specifications
        const baseSpecs: Record<string, any> = src?.specifications ?? {}
        const builtInKeys = ["color", "composition", "grade", "name", "description"]
        const customSpecs = Object.fromEntries(
          Object.entries(baseSpecs).filter(([k]) => !builtInKeys.includes(k))
        )
        const mergedSpecs = { ...customSpecs, ...extra }

        return {
          inventoryId: (newItem as any).id,
          rawMaterialData: {
            name: rest.name ?? src?.name ?? input.newTitle,
            composition: rest.composition ?? src?.composition ?? "",
            color: rest.color ?? src?.color,
            grade: rest.grade ?? src?.grade,
            description: rest.description ?? src?.description,
            specifications: Object.keys(mergedSpecs).length ? mergedSpecs : undefined,
            material_type_id: src?.material_type_id,
          },
        }
      }
    )
    const rawMaterialResult = createRawMaterialWorkflow.runAsStep({
      input: rawMaterialInput as any,
    })

    return new WorkflowResponse(
      transform({ newItem, rawMaterialResult }, ({ newItem, rawMaterialResult }) => ({
        inventory_item: {
          id: (newItem as any).id,
          title: (newItem as any).title,
        },
        raw_material: Array.isArray(rawMaterialResult)
          ? rawMaterialResult[0]
            ? { id: (rawMaterialResult[0] as any).id, name: (rawMaterialResult[0] as any).name }
            : null
          : null,
      }))
    )
  }
)
