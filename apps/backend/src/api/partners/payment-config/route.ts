import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../modules/partner-payment-config"
import { CreatePaymentConfigSchema } from "./validators"

/**
 * GET /partners/payment-config
 * List all payment configs for the authenticated partner.
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
  const configs = await configService.listPartnerPaymentConfigs({
    partner_id: partner.id,
  })

  // Mask sensitive credentials in response
  const masked = (configs || []).map((c: any) => ({
    ...c,
    credentials: maskCredentials(c.credentials),
  }))

  res.json({ payment_configs: masked })
}

/**
 * POST /partners/payment-config
 * Create a new payment config for the authenticated partner.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const body = CreatePaymentConfigSchema.parse(req.body)

  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any

  // Check if config already exists for this provider
  const existing = await configService.listPartnerPaymentConfigs({
    partner_id: partner.id,
    provider_id: body.provider_id,
  })

  if (existing?.length > 0) {
    // Update existing
    const updated = await configService.updatePartnerPaymentConfigs({
      id: existing[0].id,
      credentials: body.credentials,
      is_active: body.is_active ?? true,
      metadata: body.metadata,
    })
    return res.json({
      payment_config: { ...updated, credentials: maskCredentials(updated.credentials) },
    })
  }

  // Create new
  const config = await configService.createPartnerPaymentConfigs({
    partner_id: partner.id,
    provider_id: body.provider_id,
    credentials: body.credentials,
    is_active: body.is_active ?? true,
    metadata: body.metadata,
  })

  res.status(201).json({
    payment_config: { ...config, credentials: maskCredentials(config.credentials) },
  })
}

function maskCredentials(creds: any): any {
  if (!creds) return creds
  const masked: any = {}
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === "string" && value.length > 4) {
      masked[key] = value.slice(0, 4) + "****" + value.slice(-2)
    } else {
      masked[key] = value
    }
  }
  return masked
}
