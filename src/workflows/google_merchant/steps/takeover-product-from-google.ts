import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type TakeoverProductInput = {
  product_id: string
  account_id: string
}

export type TakeoverProductOutput = {
  deleted_from_source: boolean
  source_data_source: string | null
  google_product_name: string | null
  warning?: string
}

export const takeoverProductStep = createStep(
  "takeover-product-from-google-step",
  async (input: TakeoverProductInput, { container }) => {
    const logger = container.resolve("logger") as any
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

    const { data: links } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["product_id", "google_merchant_account_id", "google_product_name", "metadata"],
      filters: { product_id: input.product_id, google_merchant_account_id: input.account_id } as any,
    } as any)

    const link = (links?.[0] as any) || null
    const sourceDs = link?.metadata?.source_data_source as string | undefined
    const googleName = link?.google_product_name as string | undefined

    if (!link || !googleName) {
      return new StepResponse<TakeoverProductOutput>({
        deleted_from_source: false,
        source_data_source: sourceDs || null,
        google_product_name: googleName || null,
        warning: "No linked Google product to take over",
      })
    }

    const { provider, accessToken } = await service.getAuthedProvider(input.account_id)

    let deleted = false
    let warning: string | undefined
    try {
      await provider.deleteProduct(accessToken, googleName, sourceDs)
      deleted = true
    } catch (e: any) {
      // UI-managed productInputs often can't be deleted via API — that's fine,
      // we'll still insert our API version next and let Google unify by offerId.
      warning =
        "Could not delete the existing Merchant Center listing via API. " +
        "Please delete it manually in Merchant Center once the new listing is live."
      logger?.warn?.(`[takeover] delete source failed for ${googleName}: ${e.message}`)
    }

    return new StepResponse<TakeoverProductOutput>({
      deleted_from_source: deleted,
      source_data_source: sourceDs || null,
      google_product_name: googleName,
      warning,
    })
  }
)
