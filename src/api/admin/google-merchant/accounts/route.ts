import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../../modules/encryption"
import type GoogleMerchantService from "../../../../modules/google_merchant/service"
import type EncryptionService from "../../../../modules/encryption/service"
import { sanitizeAccount } from "./helpers"

type CreateBody = {
  name: string
  merchant_id: string
  client_id: string
  client_secret: string
  redirect_uri: string
  scope?: string
  account_email?: string
  api_config?: Record<string, any>
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  const filters: Record<string, any> = {}
  if (req.query.q) filters.name = req.query.q

  const [accounts, count] = await service.listAndCountGoogleMerchantAccounts(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  })

  res.status(200).json({
    accounts: accounts.map(sanitizeAccount),
    count,
    limit,
    offset,
  })
}

export const POST = async (req: MedusaRequest<CreateBody>, res: MedusaResponse) => {
  const body = req.body || ({} as CreateBody)
  const { name, merchant_id, client_id, client_secret, redirect_uri } = body

  if (!name || !merchant_id || !client_id || !client_secret || !redirect_uri) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "name, merchant_id, client_id, client_secret, and redirect_uri are required"
    )
  }

  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const encryption = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService

  const [account] = await service.createGoogleMerchantAccounts([
    {
      name,
      merchant_id,
      client_id,
      client_secret: encryption.encrypt(client_secret) as any,
      redirect_uri,
      scope: body.scope || null,
      account_email: body.account_email || null,
      api_config: body.api_config || null,
      is_active: false,
    },
  ])

  res.status(201).json({ account: sanitizeAccount(account) })
}
