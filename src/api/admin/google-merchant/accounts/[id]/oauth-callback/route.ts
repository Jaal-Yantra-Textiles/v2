import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../../../../modules/encryption"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"
import type EncryptionService from "../../../../../../modules/encryption/service"
import { GoogleMerchantProvider } from "../../../../../../modules/google_merchant/provider"

type Body = { code: string; state?: string }

export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse) => {
  const { code, state } = req.body || ({} as Body)
  if (!code) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "code is required")
  }

  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const encryption = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService

  const [account] = await service.listGoogleMerchantAccounts({ id: req.params.id }, { take: 1 })
  if (!account) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${req.params.id} not found`)
  }

  const expectedState = (account.api_config as any)?.pending_oauth_state
  if (expectedState && state && expectedState !== state) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "OAuth state mismatch")
  }

  const clientSecret = encryption.decrypt(account.client_secret as any)
  const provider = new GoogleMerchantProvider({
    client_id: account.client_id,
    client_secret: clientSecret,
    redirect_uri: account.redirect_uri,
  })

  const token = await provider.exchangeCodeForToken(code)

  let email: string | null = account.account_email || null
  try {
    const info = await provider.getUserInfo(token.access_token)
    if (info?.email) email = info.email
  } catch {}

  const apiConfig = { ...(account.api_config || {}) } as Record<string, any>
  delete apiConfig.pending_oauth_state

  await service.updateGoogleMerchantAccounts({
    id: account.id,
    access_token: token.access_token,
    refresh_token: token.refresh_token ? (encryption.encrypt(token.refresh_token) as any) : account.refresh_token,
    token_expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    account_email: email,
    is_active: true,
    api_config: apiConfig,
  })

  res.status(200).json({ success: true, connected: true })
}
