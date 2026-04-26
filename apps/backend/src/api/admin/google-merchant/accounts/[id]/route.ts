import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE, validateApiConfigPatch } from "../../../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../../../modules/encryption"
import type GoogleMerchantService from "../../../../../modules/google_merchant/service"
import type EncryptionService from "../../../../../modules/encryption/service"
import type { GoogleMerchantApiConfig } from "../../../../../modules/google_merchant"
import { sanitizeAccount } from "../helpers"

type UpdateBody = Partial<{
  name: string
  merchant_id: string
  client_id: string
  client_secret: string
  redirect_uri: string
  scope: string | null
  account_email: string | null
  api_config: GoogleMerchantApiConfig | Record<string, any> | null
  is_active: boolean
}>

async function getAccount(req: MedusaRequest) {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const [account] = await service.listGoogleMerchantAccounts({ id: req.params.id }, { take: 1 })
  if (!account) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${req.params.id} not found`)
  }
  return { service, account }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { account } = await getAccount(req)
  res.status(200).json({ account: sanitizeAccount(account) })
}

export const POST = async (req: MedusaRequest<UpdateBody>, res: MedusaResponse) => {
  const { service, account } = await getAccount(req)
  const encryption = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService
  const body = req.body || {}

  const update: Record<string, any> = { id: req.params.id }
  for (const key of ["name", "merchant_id", "client_id", "redirect_uri", "scope", "account_email", "is_active"]) {
    if (body[key as keyof UpdateBody] !== undefined) {
      update[key] = body[key as keyof UpdateBody]
    }
  }
  if (body.client_secret) {
    update.client_secret = encryption.encrypt(body.client_secret)
  }

  // api_config is treated as a partial merge patch so the UI can edit one
  // field without wiping the rest (e.g. saving feed_label shouldn't drop
  // data_source_name written by the oauth/detect flow).
  if (body.api_config !== undefined) {
    if (body.api_config === null) {
      update.api_config = null
    } else {
      try {
        const patch = validateApiConfigPatch(body.api_config)
        update.api_config = { ...(account.api_config || {}), ...patch }
      } catch (e: any) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
      }
    }
  }

  await service.updateGoogleMerchantAccounts(update)
  const [updated] = await service.listGoogleMerchantAccounts({ id: req.params.id }, { take: 1 })
  res.status(200).json({ account: sanitizeAccount(updated) })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { service } = await getAccount(req)
  await service.deleteGoogleMerchantAccounts(req.params.id)
  res.status(200).json({ id: req.params.id, deleted: true })
}
