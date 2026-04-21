import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../../../../modules/encryption"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"
import type EncryptionService from "../../../../../../modules/encryption/service"
import { GoogleMerchantProvider } from "../../../../../../modules/google_merchant/provider"

async function getAuthed(req: MedusaRequest) {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const encryption = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService
  const [account] = await service.listGoogleMerchantAccounts({ id: req.params.id }, { take: 1 })
  if (!account) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${req.params.id} not found`)
  if (!account.refresh_token) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Account not authenticated — complete OAuth first")
  }
  const clientSecret = encryption.decrypt(account.client_secret as any)
  const refreshToken = encryption.decrypt(account.refresh_token as any)
  const provider = new GoogleMerchantProvider({
    client_id: account.client_id,
    client_secret: clientSecret,
    redirect_uri: account.redirect_uri,
    merchant_id: account.merchant_id,
  })
  const refreshed = await provider.refreshAccessToken(refreshToken)
  await service.updateGoogleMerchantAccounts({
    id: account.id,
    access_token: JSON.stringify(encryption.encrypt(refreshed.access_token)),
    token_expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
  })
  return { service, encryption, account, provider, accessToken: refreshed.access_token }
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { account, provider, accessToken } = await getAuthed(req)
  const sources = await provider.listDataSources(accessToken, account.merchant_id)
  res.status(200).json({
    data_sources: sources,
    selected: (account.api_config as any)?.data_source_name || null,
  })
}

type PostBody = {
  action?: "detect" | "create" | "select"
  data_source_name?: string
  display_name?: string
}

export const POST = async (req: MedusaRequest<PostBody>, res: MedusaResponse) => {
  const { service, account, provider, accessToken } = await getAuthed(req)
  const body = req.body || {}
  const apiConfig = { ...(account.api_config || {}) } as Record<string, any>
  const contentLanguage = apiConfig.content_language || "en"
  const feedLabel = apiConfig.feed_label || "US"

  if (body.action === "select") {
    if (!body.data_source_name) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "data_source_name is required for select")
    }
    apiConfig.data_source_name = body.data_source_name
    await service.updateGoogleMerchantAccounts({ id: account.id, api_config: apiConfig })
    res.status(200).json({ selected: body.data_source_name })
    return
  }

  if (body.action === "create") {
    const created = await provider.createPrimaryApiDataSource(accessToken, account.merchant_id, {
      displayName: body.display_name || `Medusa API (${feedLabel}/${contentLanguage})`,
      contentLanguage,
      feedLabel,
      channel: "ONLINE_PRODUCTS",
    })
    apiConfig.data_source_name = created.name
    await service.updateGoogleMerchantAccounts({ id: account.id, api_config: apiConfig })
    res.status(201).json({ created, selected: created.name })
    return
  }

  // default: detect — prefer an API-input primary data source matching feedLabel+contentLanguage
  const sources = await provider.listDataSources(accessToken, account.merchant_id)
  const matching = sources.find((s) => {
    if (s.input !== "API") return false
    const primary = s.primaryProductDataSource
    if (!primary) return false
    if (primary.contentLanguage && primary.contentLanguage !== contentLanguage) return false
    if (primary.feedLabel && primary.feedLabel !== feedLabel) return false
    return true
  }) || sources.find((s) => s.input === "API" && !!s.primaryProductDataSource)

  if (matching) {
    apiConfig.data_source_name = matching.name
    await service.updateGoogleMerchantAccounts({ id: account.id, api_config: apiConfig })
    res.status(200).json({ detected: matching, selected: matching.name })
    return
  }

  // none suitable — auto-create one
  const created = await provider.createPrimaryApiDataSource(accessToken, account.merchant_id, {
    displayName: `Medusa API (${feedLabel}/${contentLanguage})`,
    contentLanguage,
    feedLabel,
    channel: "ONLINE_PRODUCTS",
  })
  apiConfig.data_source_name = created.name
  await service.updateGoogleMerchantAccounts({ id: account.id, api_config: apiConfig })
  res.status(201).json({ created, selected: created.name })
}
