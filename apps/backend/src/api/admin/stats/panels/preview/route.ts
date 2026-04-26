import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { resolvePanel } from "../../../../../modules/stats/resolver"
import { operationRegistry } from "../../../../../modules/visual_flows/operations/types"
import { previewPanelSchema } from "../../validators"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const data = previewPanelSchema.parse(req.body)

    const operation = operationRegistry.get(data.operation_type)
    if (!operation) {
      return res.status(400).json({ error: `Unknown operation_type: ${data.operation_type}` })
    }

    const optionsResult = operation.optionsSchema.safeParse(data.operation_options)
    if (!optionsResult.success) {
      return res.status(400).json({
        error: "Invalid operation_options",
        details: optionsResult.error.issues,
      })
    }

    const result = await resolvePanel(
      req.scope,
      {
        id: "preview",
        operation_type: data.operation_type,
        // optionsResult.data narrows to `unknown` under Zod v4 generics; the
        // operation registry validates it as a record-shaped schema.
        operation_options: optionsResult.data as Record<string, any>,
        display: data.display ?? {},
      },
      { skipCache: true }
    )

    res.json({
      ...result,
      display: data.display ?? {},
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", details: error.issues })
      return
    }
    res.status(400).json({ error: error.message })
  }
}
