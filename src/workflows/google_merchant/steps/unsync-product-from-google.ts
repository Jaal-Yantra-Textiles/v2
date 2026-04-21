import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import productGoogleMerchantLink from "../../../links/product-google-merchant-link"

const LINK_ENTRY = productGoogleMerchantLink.entryPoint

export type UnsyncProductInput = {
  product_id: string
  account_id: string
}

export const unsyncProductFromGoogleStep = createStep(
  "unsync-product-from-google-step",
  async (input: UnsyncProductInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const googleMerchantService = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
    const logger = container.resolve("logger") as any

    const { data: links } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["google_product_name", "google_product_id", "metadata"],
      filters: {
        product_id: input.product_id,
        google_merchant_account_id: input.account_id,
      },
    } as any)

    const link = links?.[0] as any
    const googleProductName = link?.google_product_name as string | undefined
    const sourceDs = link?.metadata?.source_data_source as string | undefined

    if (googleProductName) {
      try {
        const { provider, accessToken } = await googleMerchantService.getAuthedProvider(input.account_id)
        await provider.deleteProduct(accessToken, googleProductName, sourceDs)
      } catch (e: any) {
        logger?.warn?.(
          `[unsync-product] Google delete failed for ${googleProductName}: ${e.message} — dismissing local link anyway`
        )
      }
    }

    await remoteLink.dismiss([
      {
        [Modules.PRODUCT]: { product_id: input.product_id },
        [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: input.account_id },
      },
    ])

    return new StepResponse({ success: true })
  }
)
