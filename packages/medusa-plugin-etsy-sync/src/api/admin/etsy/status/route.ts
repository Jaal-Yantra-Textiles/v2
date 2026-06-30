import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../modules/etsy-sync"
import EtsySyncService from "../../../../modules/etsy-sync/service"

// GET /admin/etsy/status — connection status + readiness checklist
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const account = await service.getActiveAccount()
  const settings = await service.getSettings()

  const connected = !!account && account.is_active
  const hasShipping = !!settings.default_shipping_profile_id
  const hasReturnPolicy = !!settings.default_return_policy_id
  const hasReadiness = !!settings.default_readiness_state_id
  const hasTaxonomy = !!settings.default_taxonomy_id

  res.json({
    connected,
    account: account
      ? {
          id: account.id,
          shop_id: account.shop_id,
          shop_name: account.shop_name,
          shop_url: account.shop_url,
          currency: account.currency,
          token_expires_at: account.token_expires_at,
        }
      : null,
    settings: {
      default_taxonomy_id: settings.default_taxonomy_id,
      default_shipping_profile_id: settings.default_shipping_profile_id,
      default_return_policy_id: settings.default_return_policy_id,
      default_readiness_state_id: settings.default_readiness_state_id,
      default_who_made: settings.default_who_made,
      default_when_made: settings.default_when_made,
      default_is_supply: settings.default_is_supply,
      default_type: settings.default_type,
      auto_publish: settings.auto_publish,
      follow_product_status: settings.follow_product_status,
    },
    readiness: {
      connected,
      shipping_profile: hasShipping,
      return_policy: hasReturnPolicy,
      readiness_state: hasReadiness,
      taxonomy: hasTaxonomy,
      ready_to_publish:
        connected && hasShipping && hasReturnPolicy && hasReadiness && hasTaxonomy,
    },
  })
}
