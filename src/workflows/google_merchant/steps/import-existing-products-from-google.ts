import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules, MedusaError } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import { GOOGLE_MERCHANT_MODULE } from "../../../modules/google_merchant"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type GoogleMerchantService from "../../../modules/google_merchant/service"
import type EncryptionService from "../../../modules/encryption/service"
import { GoogleMerchantProvider, GoogleProductInput } from "../../../modules/google_merchant/provider"

const LINK_ENTITY = "product_product_google_merchant_google_merchant_account"

export type ImportExistingInput = {
  account_id: string
  dry_run?: boolean
}

export type ImportExistingOutput = {
  account_id: string
  google_total: number
  matched: number
  linked: number
  externally_managed: number
  skipped_existing_link: number
  unmatched: Array<{ offer_id: string; google_name: string }>
}

export const importExistingProductsFromGoogleStep = createStep(
  "import-existing-products-from-google-step",
  async (input: ImportExistingInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
    const service = container.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

    const [account] = await service.listGoogleMerchantAccounts({ id: input.account_id }, { take: 1 })
    if (!account) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Account ${input.account_id} not found`)
    if (!account.refresh_token) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Account not authenticated")
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
    const accessToken = refreshed.access_token
    await service.updateGoogleMerchantAccounts({
      id: account.id,
      access_token: JSON.stringify(encryption.encrypt(accessToken)),
      token_expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
    })

    // Paginate through all Google productInputs
    const allInputs: GoogleProductInput[] = []
    let pageToken: string | undefined
    let pagesFetched = 0
    do {
      const page = await provider.listProductInputs(accessToken, account.merchant_id, {
        pageSize: 250,
        pageToken,
      })
      allInputs.push(...page.productInputs)
      pageToken = page.nextPageToken
      pagesFetched++
      if (pagesFetched > 50) break // safety — ~12.5k products
    } while (pageToken)

    if (allInputs.length === 0) {
      return new StepResponse<ImportExistingOutput>({
        account_id: input.account_id,
        google_total: 0,
        matched: 0,
        linked: 0,
        externally_managed: 0,
        skipped_existing_link: 0,
        unmatched: [],
      })
    }

    const ourDataSource = (account.api_config as any)?.data_source_name as string | undefined

    // Look up Medusa products whose handle matches any Google offerId
    const offerIds = allInputs.map((p) => p.offerId).filter(Boolean)
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "handle"],
      filters: { handle: offerIds } as any,
    } as any)

    const handleToProductId = new Map<string, string>()
    for (const p of (products || []) as Array<{ id: string; handle: string }>) {
      if (p.handle) handleToProductId.set(p.handle, p.id)
    }

    // Look up existing links for this account so we don't overwrite
    const { data: existingLinks } = await query.graph({
      entity: LINK_ENTITY,
      fields: ["product_id", "google_merchant_account_id"],
      filters: { google_merchant_account_id: input.account_id } as any,
    } as any)
    const linkedProductIds = new Set(
      ((existingLinks || []) as Array<{ product_id: string }>).map((l) => l.product_id)
    )

    const unmatched: Array<{ offer_id: string; google_name: string }> = []
    let matched = 0
    let linked = 0
    let skipped = 0
    let externallyManaged = 0

    for (const gp of allInputs) {
      const productId = handleToProductId.get(gp.offerId)
      if (!productId) {
        unmatched.push({ offer_id: gp.offerId, google_name: gp.name })
        continue
      }
      matched++

      if (linkedProductIds.has(productId)) {
        skipped++
        continue
      }

      const sourceDs = gp.dataSource || null
      const isExternallyManaged = !!sourceDs && !!ourDataSource && sourceDs !== ourDataSource
      if (isExternallyManaged) externallyManaged++

      if (input.dry_run) continue

      try {
        await remoteLink.create([
          {
            [Modules.PRODUCT]: { product_id: productId },
            [GOOGLE_MERCHANT_MODULE]: { google_merchant_account_id: input.account_id },
            data: {
              sync_status: "synced",
              google_product_id: gp.offerId,
              google_product_name: gp.name,
              last_synced_at: new Date(),
              sync_error: null,
              metadata: {
                imported: true,
                imported_at: new Date().toISOString(),
                source_data_source: sourceDs,
                externally_managed: isExternallyManaged,
              },
            },
          },
        ])
        linked++
      } catch {
        skipped++
      }
    }

    return new StepResponse<ImportExistingOutput>({
      account_id: input.account_id,
      google_total: allInputs.length,
      matched,
      linked,
      externally_managed: externallyManaged,
      skipped_existing_link: skipped,
      unmatched,
    })
  }
)
