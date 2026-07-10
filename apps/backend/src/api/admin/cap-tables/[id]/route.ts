import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"
import { capTableUpdateSchema } from "../../../investors/validators"
import { refetchCapTable } from "../../../investors/helpers"

// GET /admin/cap-tables/:id — cap table detail (+ share classes, rounds, stakes, docs)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const fresh = await refetchCapTable(req.params.id, req.scope)
  if (!fresh) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cap table not found")
  }
  res.json({ cap_table: fresh })
}

// POST /admin/cap-tables/:id — update cap table (totals, valuations, status)
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = capTableUpdateSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await service.updateCapTables({ id: req.params.id, ...data } as any)
  const fresh = await refetchCapTable(req.params.id, req.scope)
  res.json({ cap_table: fresh })
}
