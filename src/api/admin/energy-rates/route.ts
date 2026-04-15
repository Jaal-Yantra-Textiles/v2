import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ENERGY_RATES_MODULE } from "../../../modules/energy_rates"
import type EnergyRateService from "../../../modules/energy_rates/service"
import type { AdminCreateEnergyRateReq } from "./validators"

export const POST = async (
  req: MedusaRequest<AdminCreateEnergyRateReq>,
  res: MedusaResponse
) => {
  const service: EnergyRateService = req.scope.resolve(ENERGY_RATES_MODULE)

  const energyRate = await service.createEnergyRates({
    name: req.validatedBody.name,
    energy_type: req.validatedBody.energyType,
    unit_of_measure: req.validatedBody.unitOfMeasure || "Other",
    rate_per_unit: req.validatedBody.ratePerUnit,
    currency: req.validatedBody.currency || "inr",
    effective_from: new Date(req.validatedBody.effectiveFrom),
    effective_to: req.validatedBody.effectiveTo
      ? new Date(req.validatedBody.effectiveTo)
      : null,
    region: req.validatedBody.region || null,
    is_active: req.validatedBody.isActive ?? true,
    notes: req.validatedBody.notes || null,
    metadata: req.validatedBody.metadata || null,
  })

  res.status(201).json({ energy_rate: energyRate })
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EnergyRateService = req.scope.resolve(ENERGY_RATES_MODULE)
  const query = req.query as Record<string, any>

  const filters: Record<string, any> = {}
  if (query.energy_type) filters.energy_type = query.energy_type
  if (query.is_active !== undefined) filters.is_active = query.is_active === "true"
  if (query.region) filters.region = query.region

  const [energyRates, count] = await service.listAndCountEnergyRates(filters, {
    take: query.limit ? parseInt(query.limit, 10) : 50,
    skip: query.offset ? parseInt(query.offset, 10) : 0,
    order: { effective_from: "DESC" },
  })

  res.status(200).json({ energy_rates: energyRates, count })
}
