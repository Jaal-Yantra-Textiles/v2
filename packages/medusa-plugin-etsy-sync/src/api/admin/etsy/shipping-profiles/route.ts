import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../modules/etsy-sync"
import EtsySyncService from "../../../../modules/etsy-sync/service"

// GET /admin/etsy/shipping-profiles
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const account = await service.ensureFreshToken()
  const client = service.getClient()
  const profiles = await client.getShopShippingProfiles(
    account.access_token,
    account.shop_id
  )
  res.json({ shipping_profiles: profiles })
}
