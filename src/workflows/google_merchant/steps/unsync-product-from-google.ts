import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import type EncryptionService from "../../../modules/encryption/service"
import { GoogleMerchantProvider } from "../../../modules/google_merchant/provider"
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
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

    const [account] = await googleMerchantService.listGoogleMerchantAccounts(
      { id: input.account_id },
      { take: 1 }
    )
    if (!account) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${input.account_id} not found`)
    }

    const { data: links } = await query.graph({
      entity: LINK_ENTRY,
      fields: ["google_product_name", "google_product_id"],
      filters: {
        product_id: input.product_id,
        google_merchant_account_id: input.account_id,
      },
    } as any)

    const link = links?.[0] as any
    const googleProductName = link?.google_product_name as string | undefined

    if (googleProductName && account.refresh_token) {
      try {
        const clientSecret = encryption.decrypt(account.client_secret as any)
        const refreshToken = encryption.decrypt(account.refresh_token as any)
        const provider = new GoogleMerchantProvider({
          client_id: account.client_id,
          client_secret: clientSecret,
          redirect_uri: account.redirect_uri,
        })
        const refreshed = await provider.refreshAccessToken(refreshToken)
        await provider.deleteProduct(refreshed.access_token, googleProductName)
      } catch (e: any) {
        const logger = container.resolve("logger") as any
        logger.warn(
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
