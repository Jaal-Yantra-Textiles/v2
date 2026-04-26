import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ENERGY_RATES_MODULE } from "../../../../modules/energy_rates"
import type EnergyRateService from "../../../../modules/energy_rates/service"
import type { AdminUpdateEnergyRateReq } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EnergyRateService = req.scope.resolve(ENERGY_RATES_MODULE)

  const energyRate = await service
    .retrieveEnergyRate(req.params.id)
    .catch(() => null)

  if (!energyRate) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Energy rate ${req.params.id} not found`
    )
  }

  res.status(200).json({ energy_rate: energyRate })
}

export const POST = async (
  req: MedusaRequest<AdminUpdateEnergyRateReq>,
  res: MedusaResponse
) => {
  const service: EnergyRateService = req.scope.resolve(ENERGY_RATES_MODULE)

  const existing = await service
    .retrieveEnergyRate(req.params.id)
    .catch(() => null)

  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Energy rate ${req.params.id} not found`
    )
  }

  const updateData: Record<string, any> = { id: req.params.id }

  if (req.validatedBody.name !== undefined) updateData.name = req.validatedBody.name
  if (req.validatedBody.energyType !== undefined) updateData.energy_type = req.validatedBody.energyType
  if (req.validatedBody.unitOfMeasure !== undefined) updateData.unit_of_measure = req.validatedBody.unitOfMeasure
  if (req.validatedBody.ratePerUnit !== undefined) updateData.rate_per_unit = req.validatedBody.ratePerUnit
  if (req.validatedBody.currency !== undefined) updateData.currency = req.validatedBody.currency
  if (req.validatedBody.effectiveFrom !== undefined) updateData.effective_from = new Date(req.validatedBody.effectiveFrom)
  if (req.validatedBody.effectiveTo !== undefined) updateData.effective_to = req.validatedBody.effectiveTo ? new Date(req.validatedBody.effectiveTo) : null
  if (req.validatedBody.region !== undefined) updateData.region = req.validatedBody.region
  if (req.validatedBody.isActive !== undefined) updateData.is_active = req.validatedBody.isActive
  if (req.validatedBody.notes !== undefined) updateData.notes = req.validatedBody.notes
  if (req.validatedBody.metadata !== undefined) updateData.metadata = req.validatedBody.metadata

  const energyRate = await service.updateEnergyRates(updateData)

  res.status(200).json({ energy_rate: energyRate })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EnergyRateService = req.scope.resolve(ENERGY_RATES_MODULE)

  await service.deleteEnergyRates(req.params.id)

  res.status(200).json({ id: req.params.id, deleted: true })
}
