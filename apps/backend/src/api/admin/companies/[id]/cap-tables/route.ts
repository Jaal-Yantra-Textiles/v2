import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { capTableSchema } from "../../../../investors/validators"
import { refetchCapTable } from "../../../../investors/helpers"

// GET /admin/companies/:id/cap-tables — cap tables for this company (+ children)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cap_tables",
    filters: { company_id: req.params.id },
    fields: [
      "*",
      "share_classes.*",
      "funding_rounds.*",
      "stakes.*",
      "calls_for_shares.*",
      "documents.*",
    ],
  })
  res.json({ cap_tables: data || [], count: (data || []).length })
}

// POST /admin/companies/:id/cap-tables — create a cap table for this company
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // company_id comes from the URL, not the body (mirror the nested-create pattern).
  const data = capTableSchema.parse({ ...(req.body as Record<string, any>), company_id: req.params.id })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createCapTables(data as any)
  const fresh = await refetchCapTable(created.id, req.scope)
  res.status(201).json({ cap_table: fresh })
}
