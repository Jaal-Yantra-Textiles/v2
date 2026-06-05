/**
 * @file Partner design cost read
 * @description Roadmap #6 Phase 3 — read the persisted cost fields for
 * a partner-owned design (estimated / material / production cost +
 * breakdown). Populated by `POST .../recalculate-cost`.
 * @module API/Partners/Designs/Cost
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertPartnerOwnsDesign } from "../../helpers"

export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "design",
    filters: { id: designId },
    fields: [
      "id",
      "estimated_cost",
      "material_cost",
      "production_cost",
      "cost_breakdown",
      "cost_currency",
    ],
  })
  const design = (data || [])[0] as any

  res.status(200).json({
    design_id: designId,
    estimated_cost: design?.estimated_cost ?? null,
    material_cost: design?.material_cost ?? null,
    production_cost: design?.production_cost ?? null,
    cost_breakdown: design?.cost_breakdown ?? null,
    cost_currency: design?.cost_currency ?? null,
  })
}
