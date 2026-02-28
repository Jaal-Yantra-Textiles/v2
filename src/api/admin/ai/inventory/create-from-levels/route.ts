/**
 * @file Admin AI Inventory API route for creating inventory items with levels
 * @description Provides an endpoint for creating inventory items and their associated inventory levels in the JYT Commerce platform
 * @module API/Admin/AI/Inventory
 */

/**
 * @typedef {Object} InventoryItemInput
 * @property {string} title.required - The title of the inventory item
 * @property {string} [sku] - The SKU (Stock Keeping Unit) of the inventory item
 * @property {string} [description] - The description of the inventory item
 * @property {number} [quantity=0] - The quantity of the inventory item (must be a non-negative integer)
 * @property {string} [storage="incoming"] - The storage type for the quantity ("incoming" or "stocked")
 * @property {string} [stock_location_id] - The ID of the stock location where the inventory will be stored
 */

/**
 * @typedef {Object} InventoryItemResponse
 * @property {string} id - The unique identifier of the inventory item
 * @property {string} title - The title of the inventory item
 * @property {string} [sku] - The SKU of the inventory item
 * @property {string} [description] - The description of the inventory item
 * @property {Date} created_at - When the inventory item was created
 * @property {Date} updated_at - When the inventory item was last updated
 */

/**
 * @typedef {Object} InventoryLevelResponse
 * @property {string} id - The unique identifier of the inventory level
 * @property {string} inventory_item_id - The ID of the associated inventory item
 * @property {string} location_id - The ID of the stock location
 * @property {number} stocked_quantity - The quantity of items currently in stock
 * @property {number} incoming_quantity - The quantity of items incoming
 * @property {Date} created_at - When the inventory level was created
 * @property {Date} updated_at - When the inventory level was last updated
 */

/**
 * Create an inventory item with associated inventory levels
 * @route POST /admin/ai/inventory/create-from-levels
 * @group Inventory - Operations related to inventory management
 * @param {InventoryItemInput} request.body.required - Inventory item data to create
 * @returns {Object} 201 - Created inventory item and levels
 * @returns {Object} 201 - Partial success with inventory item but no levels (when no stock location is available)
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 500 - Unexpected server error
 *
 * @example request
 * POST /admin/ai/inventory/create-from-levels
 * {
 *   "title": "Premium Wireless Headphones",
 *   "sku": "AUDIO-WH-2023",
 *   "description": "High-quality wireless headphones with noise cancellation",
 *   "quantity": 50,
 *   "storage": "stocked",
 *   "stock_location_id": "loc_123456789"
 * }
 *
 * @example response 201
 * {
 *   "message": "Inventory item and level created",
 *   "inventory_item": {
 *     "id": "inv_item_123456789",
 *     "title": "Premium Wireless Headphones",
 *     "sku": "AUDIO-WH-2023",
 *     "description": "High-quality wireless headphones with noise cancellation",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   },
 *   "inventory_levels": [
 *     {
 *       "id": "inv_level_987654321",
 *       "inventory_item_id": "inv_item_123456789",
 *       "location_id": "loc_123456789",
 *       "stocked_quantity": 50,
 *       "incoming_quantity": 0,
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ]
 * }
 *
 * @example response 201 (partial success)
 * {
 *   "message": "Inventory item created but no stock location available for levels",
 *   "inventory_item": {
 *     "id": "inv_item_123456789",
 *     "title": "Premium Wireless Headphones",
 *     "sku": "AUDIO-WH-2023",
 *     "description": "High-quality wireless headphones with noise cancellation",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   },
 *   "hint": "Pass stock_location_id in the request to create levels"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { createInventoryItemsWorkflow, createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

const BodySchema = z.object({
  title: z.string().min(1, "title is required"),
  sku: z.string().optional(),
  description: z.string().optional(),
  // If storage === "stocked" then quantity goes to stocked_quantity; otherwise to incoming_quantity
  quantity: z.number().int().min(0).default(0).optional(),
  storage: z.enum(["incoming", "stocked"]).default("incoming").optional(),
  stock_location_id: z.string().optional(),
})

type BodyType = z.infer<typeof BodySchema>

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const parsed = BodySchema.safeParse((req as any).validatedBody || (req.body as BodyType))
    if (!parsed.success) {
      const msg = parsed.error.errors.map((e) => e.message).join(", ")
      throw new MedusaError(MedusaError.Types.INVALID_DATA, msg || "Invalid request body")
    }
    const body = parsed.data

    // 1) Create inventory item
    const { result: created } = await createInventoryItemsWorkflow(req.scope).run({
      input: {
        items: [
          {
            title: body.title,
            description: body.description,
            sku: body.sku,
          },
        ],
      },
    })

    const createdItems: any[] = (created as any)?.items || (created as any) || []
    if (!createdItems.length) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to create inventory item")
    }
    const inventoryItem = createdItems[0]

    // 2) Resolve stock location
    let stockLocationId = body.stock_location_id
    if (!stockLocationId) {
      try {
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "stock_location", fields: ["id"] })
        stockLocationId = Array.isArray(data) && data.length ? data[0].id : undefined
      } catch (e) {
        // best-effort
      }
    }

    if (!stockLocationId) {
      // We created the item but cannot attach a level without a location; return partial success with guidance
      return res.status(201).json({
        message: "Inventory item created but no stock location available for levels",
        inventory_item: inventoryItem,
        hint: "Pass stock_location_id in the request to create levels",
      })
    }

    // 3) Create inventory level with either incoming or stocked quantity
    const qty = Number(body.quantity ?? 0)
    const isStocked = body.storage === "stocked"
    const levelsInput = [
      {
        inventory_item_id: inventoryItem.id,
        location_id: stockLocationId,
        stocked_quantity: isStocked ? qty : 0,
        incoming_quantity: isStocked ? 0 : qty,
      },
    ]

    const { result: levelRes } = await createInventoryLevelsWorkflow(req.scope).run({
      input: { inventory_levels: levelsInput },
    })

    return res.status(201).json({
      message: "Inventory item and level created",
      inventory_item: inventoryItem,
      inventory_levels: levelRes,
    })
  } catch (e) {
    const err = e as Error
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: err.message })
    }
    return res.status(500).json({ message: err.message || "Unexpected error" })
  }
}
