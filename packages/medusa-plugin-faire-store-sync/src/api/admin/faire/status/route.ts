import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FAIRE_SYNC_MODULE } from "../../../../modules/faire-sync"
import FaireSyncService from "../../../../modules/faire-sync/service"

// GET /admin/faire/status — connection status + readiness checklist
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const account = await service.getActiveAccount()
  const settings = await service.getSettings()

  const connected = !!account && account.is_active
  const hasBrand = !!settings.default_brand_id
  const hasMarkup =
    settings.default_wholesale_markup_percent != null &&
    settings.default_wholesale_markup_percent > 0
  const hasShipping = !!settings.default_shipping_policy_id

  res.json({
    connected,
    account: account
      ? {
          id: account.id,
          brand_id: account.brand_id,
          brand_name: account.brand_name,
          currency: account.currency,
          token_expires_at: account.token_expires_at,
        }
      : null,
    settings: {
      default_brand_id: settings.default_brand_id,
      default_wholesale_markup_percent: settings.default_wholesale_markup_percent,
      default_min_order_quantity: settings.default_min_order_quantity,
      default_lead_time_days: settings.default_lead_time_days,
      default_shipping_policy_id: settings.default_shipping_policy_id,
      default_category: settings.default_category,
      auto_publish: settings.auto_publish,
      follow_product_status: settings.follow_product_status,
    },
    readiness: {
      connected,
      brand: hasBrand,
      wholesale_pricing: hasMarkup,
      shipping_policy: hasShipping,
      ready_to_publish: connected && hasBrand,
    },
  })
}
