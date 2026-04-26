import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { operationRegistry } from "../../../../modules/visual_flows/operations/types"

export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const all = operationRegistry.getDefinitionsForUI()
  const dataOps = all.filter((op) => op.category === "data")

  res.json({
    operations: dataOps.map((op) => ({
      type: op.type,
      name: op.name,
      description: op.description,
      icon: op.icon,
      category: op.category,
      defaultOptions: op.defaultOptions ?? {},
    })),
    count: dataOps.length,
  })
}
