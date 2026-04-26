import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../../modules/partner-payment-config"
import { UpdatePaymentConfigSchema } from "../validators"

/**
 * GET /partners/payment-config/:configId
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any
  const config = await configService.retrievePartnerPaymentConfig(req.params.configId)

  if (!config || config.partner_id !== partner.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Payment config not found")
  }

  res.json({ payment_config: config })
}

/**
 * POST /partners/payment-config/:configId
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any
  const existing = await configService.retrievePartnerPaymentConfig(req.params.configId)

  if (!existing || existing.partner_id !== partner.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Payment config not found")
  }

  const body = UpdatePaymentConfigSchema.parse(req.body)

  const updated = await configService.updatePartnerPaymentConfigs({
    id: req.params.configId,
    ...body,
  })

  res.json({ payment_config: updated })
}

/**
 * DELETE /partners/payment-config/:configId
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any
  const existing = await configService.retrievePartnerPaymentConfig(req.params.configId)

  if (!existing || existing.partner_id !== partner.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Payment config not found")
  }

  await configService.deletePartnerPaymentConfigs(req.params.configId)

  res.json({ id: req.params.configId, object: "partner_payment_config", deleted: true })
}
