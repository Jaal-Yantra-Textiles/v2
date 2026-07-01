import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { Link } from "@medusajs/modules-sdk"
import type { IInventoryService, LinkDefinition } from "@medusajs/types"
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material"
import RawMaterialInventoryLink from "../../links/raw-material-data-inventory"
import {
  buildSkuPrefix,
  formatSku,
  nextSequenceNumber,
} from "../../utils/generate-sku"
import {
  buildItemIdByRawMaterialId,
  splitResolvedAndMissing,
  buildResolvedOrderLines,
  type GroupOrderLineInput,
  type ResolvedGroupOrderLine,
} from "../../modules/raw_material/lib/group-order-helpers"

export type ResolveGroupColorItemsInput = {
  lines: GroupOrderLineInput[]
  stock_location_id?: string
}

export type ResolveGroupColorItemsResult = {
  order_lines: ResolvedGroupOrderLine[]
  created_inventory_item_ids: string[]
}

/**
 * #817 S3 — for each requested color (raw_material) in a group order, resolve
 * its inventory_item, AUTO-CREATING the item (with SKU + link + a zero-stock
 * level) when the color doesn't have one yet. Returns fan-out order lines
 * ({ inventory_item_id, quantity, price }) ready for the create-order workflow.
 *
 * The item creation loop is data-dependent (N unknown at definition time) so it
 * runs imperatively inside this one step, reusing the SKU util + link shape from
 * create-raw-material. Compensation deletes only the items this step created.
 */
export const resolveOrCreateColorInventoryItemsStep = createStep(
  "resolve-or-create-color-inventory-items",
  async (input: ResolveGroupColorItemsInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    const rawMaterialService: any = container.resolve(RAW_MATERIAL_MODULE)

    const rawMaterialIds = Array.from(
      new Set((input.lines ?? []).map((l) => l.raw_material_id).filter(Boolean))
    )
    if (!rawMaterialIds.length) {
      throw new Error("At least one color (raw_material_id) is required.")
    }

    // 1) Which colors already have an inventory_item?
    const { data: linkRows } = await query.graph({
      entity: RawMaterialInventoryLink.entryPoint,
      fields: ["raw_materials.id", "inventory_item.id"],
      filters: { raw_materials_id: rawMaterialIds },
    })
    const itemIdByRawMaterialId = buildItemIdByRawMaterialId(linkRows as any)

    const { missingRawMaterialIds } = splitResolvedAndMissing(
      input.lines,
      itemIdByRawMaterialId
    )

    const createdInventoryItemIds: string[] = []
    const createdLinks: LinkDefinition[] = []

    // 2) Create the missing per-color inventory items (+ link + SKU + level).
    if (missingRawMaterialIds.length) {
      const rawMaterials = await rawMaterialService.listRawMaterials(
        { id: missingRawMaterialIds },
        { relations: ["material_type"] }
      )
      const rmById = new Map<string, any>(
        (rawMaterials ?? []).map((rm: any) => [rm.id, rm])
      )
      // Track SKUs assigned within this batch so two new items sharing a prefix
      // don't collide on the same sequence number.
      const localSkusByPrefix: Record<string, string[]> = {}

      for (const rawMaterialId of missingRawMaterialIds) {
        const rm = rmById.get(rawMaterialId)
        if (!rm) {
          throw new Error(`Raw material ${rawMaterialId} not found for group order.`)
        }

        // 2a) Create the inventory item.
        const [item] = await inventoryService.createInventoryItems([
          { title: rm.name } as any,
        ])
        createdInventoryItemIds.push(item.id)

        // 2b) Link it to the raw material (same shape as create-raw-material).
        const link: LinkDefinition = {
          [Modules.INVENTORY]: { inventory_item_id: item.id },
          [RAW_MATERIAL_MODULE]: { raw_materials_id: rawMaterialId },
          data: { raw_materials_id: rawMaterialId, inventory_id: item.id },
        }
        await remoteLink.create(link)
        createdLinks.push(link)

        // 2c) Generate + assign a descriptive SKU (mirrors generateSkuStep).
        const category = rm.material_type?.category || "Other"
        const prefix = buildSkuPrefix(category, rm.name, rm.color)
        const { data: existingItems } = await query.graph({
          entity: "inventory_item",
          fields: ["sku"],
          filters: { sku: { $like: `${prefix}-%` } },
        })
        const existingSkus = [
          ...existingItems.map((i: any) => i.sku).filter(Boolean),
          ...(localSkusByPrefix[prefix] ?? []),
        ] as string[]
        const sku = formatSku(prefix, nextSequenceNumber(existingSkus, prefix))
        localSkusByPrefix[prefix] = [...(localSkusByPrefix[prefix] ?? []), sku]
        await inventoryService.updateInventoryItems({ id: item.id, sku } as any)

        // 2d) Seed a zero-stock level at the receiving location (best-effort).
        if (input.stock_location_id) {
          try {
            await inventoryService.createInventoryLevels([
              {
                inventory_item_id: item.id,
                location_id: input.stock_location_id,
                stocked_quantity: 0,
                incoming_quantity: 0,
              } as any,
            ])
          } catch {
            // non-fatal — the order can still be placed without a seeded level.
          }
        }

        itemIdByRawMaterialId[rawMaterialId] = item.id
      }
    }

    // 3) Fan out into resolved order lines (throws if any color still unresolved).
    const order_lines = buildResolvedOrderLines(input.lines, itemIdByRawMaterialId)

    return new StepResponse(
      { order_lines, created_inventory_item_ids: createdInventoryItemIds } as ResolveGroupColorItemsResult,
      { createdInventoryItemIds, createdLinks }
    )
  },
  // Compensation — only undo items THIS step created.
  async (compensationData, { container }) => {
    if (!compensationData) return
    const { createdInventoryItemIds, createdLinks } = compensationData as {
      createdInventoryItemIds: string[]
      createdLinks: LinkDefinition[]
    }
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const inventoryService: IInventoryService = container.resolve(Modules.INVENTORY)
    try {
      if (createdLinks?.length) {
        await remoteLink.dismiss(createdLinks as any)
      }
    } catch {
      /* best-effort */
    }
    try {
      if (createdInventoryItemIds?.length) {
        await inventoryService.deleteInventoryItems(createdInventoryItemIds)
      }
    } catch {
      /* best-effort */
    }
  }
)

/**
 * Standalone workflow so the route can resolve/create the per-color items first
 * (with its own compensation), then hand the resulting order_lines to the
 * existing createInventoryOrderWorkflow (which denormalizes color per S2).
 */
export const resolveGroupColorInventoryItemsWorkflow = createWorkflow(
  "resolve-group-color-inventory-items",
  (input: ResolveGroupColorItemsInput) => {
    const result = resolveOrCreateColorInventoryItemsStep(input)
    return new WorkflowResponse(result)
  }
)
