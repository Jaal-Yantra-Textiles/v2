import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { GOOGLE_MERCHANT_MODULE } from "../../../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../../../modules/google_merchant/service"

async function getAuthed(req: MedusaRequest) {
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
  const { account, provider, accessToken } = await service.getAuthedProvider(req.params.id)
  return { service, account, provider, accessToken }
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
