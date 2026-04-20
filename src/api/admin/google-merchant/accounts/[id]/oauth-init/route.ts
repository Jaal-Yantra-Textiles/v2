import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import crypto from "crypto"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../../../../modules/encryption"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"
import type EncryptionService from "../../../../../../modules/encryption/service"
import { GoogleMerchantProvider } from "../../../../../../modules/google_merchant/provider"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const encryption = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService

  const [account] = await service.listGoogleMerchantAccounts({ id: req.params.id }, { take: 1 })
  if (!account) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${req.params.id} not found`)
  }

  const clientSecret = encryption.decrypt(account.client_secret as any)
  const provider = new GoogleMerchantProvider({
    client_id: account.client_id,
    client_secret: clientSecret,
    redirect_uri: account.redirect_uri,
  })

  const state = crypto.randomBytes(16).toString("hex")
  const location = provider.getAuthorizationUrl(state, account.scope || undefined)

  await service.updateGoogleMerchantAccounts({
    id: account.id,
    api_config: { ...(account.api_config || {}), pending_oauth_state: state },
  })

  res.status(200).json({ location, state })
}
