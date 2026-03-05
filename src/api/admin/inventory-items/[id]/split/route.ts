import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { splitInventoryItemWorkflow } from "../../../../../workflows/inventory/split-inventory-item"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as {
    quantity: number
    new_title: string
    raw_material_overrides?: {
      name?: string
      color?: string
      composition?: string
      grade?: string
      description?: string
      extra?: Record<string, string>
    }
  }

  const { result, errors } = await splitInventoryItemWorkflow(req.scope).run({
    input: {
      sourceInventoryItemId: req.params.id,
      quantity: body.quantity,
      newTitle: body.new_title,
      rawMaterialOverrides: body.raw_material_overrides,
    },
  })

  if (errors && errors.length > 0) {
    console.warn("Split inventory workflow errors:", errors)
    throw errors[0]
  }

  res.status(201).json(result)
}
