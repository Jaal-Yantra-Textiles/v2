import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
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
