import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { RemoteQueryFunction } from "@medusajs/types"
import { GOOGLE_MERCHANT_MODULE } from "../../../../modules/google_merchant"
import type GoogleMerchantService from "../../../../modules/google_merchant/service"

const LINK_ENTITY = "product_product_google_merchant_google_merchant_account"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product_id = req.query.product_id as string
  if (!product_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "product_id query parameter is required")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
  const service = req.scope.resolve(GOOGLE_MERCHANT_MODULE) as GoogleMerchantService

  const [accounts] = await service.listAndCountGoogleMerchantAccounts({}, { take: 200 } as any)

  let links: any[] = []
  try {
    const { data } = await query.graph({
      entity: LINK_ENTITY,
      fields: [
        "product_id",
        "google_merchant_account_id",
        "sync_status",
        "google_product_id",
        "google_product_name",
        "last_synced_at",
        "sync_error",
        "metadata",
      ],
      filters: { product_id },
    } as any)
    links = data || []
  } catch (e: any) {
    req.scope.resolve("logger").warn(`[product-sync-status] link query failed: ${e.message}`)
  }

  const linkByAccount = new Map<string, any>(
    links.map((l: any) => [l.google_merchant_account_id, l])
  )

  const result = accounts.map((a: any) => {
    const link = linkByAccount.get(a.id)
    return {
      account_id: a.id,
      account_name: a.name,
      merchant_id: a.merchant_id,
      account_email: a.account_email,
      connected: !!a.refresh_token,
      sync_status: link?.sync_status || "not_synced",
      google_product_id: link?.google_product_id || null,
      google_product_name: link?.google_product_name || null,
      last_synced_at: link?.last_synced_at || null,
      sync_error: link?.sync_error || null,
      externally_managed: !!link?.metadata?.externally_managed,
      source_data_source: link?.metadata?.source_data_source || null,
    }
  })

  res.status(200).json({
    product_id,
    links: result,
  })
}
