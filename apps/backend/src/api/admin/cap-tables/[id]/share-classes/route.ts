import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { shareClassSchema } from "../../../../investors/validators"

// GET /admin/cap-tables/:id/share-classes
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listShareClasses({ cap_table_id: req.params.id } as any)
  res.json({ share_classes: items, count: items.length })
}

// POST /admin/cap-tables/:id/share-classes
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = shareClassSchema.parse({ ...(req.body as Record<string, any>), cap_table_id: req.params.id })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createShareClasses(data as any)
  res.status(201).json({ share_class: created })
}
