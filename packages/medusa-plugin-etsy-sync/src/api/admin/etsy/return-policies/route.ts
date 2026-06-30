import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ETSY_SYNC_MODULE } from "../../../../modules/etsy-sync"
import EtsySyncService from "../../../../modules/etsy-sync/service"

// GET /admin/etsy/return-policies
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: EtsySyncService = req.scope.resolve(ETSY_SYNC_MODULE)
  const account = await service.ensureFreshToken()
  const client = service.getClient()
  const policies = await client.getShopReturnPolicies(
    account.access_token,
    account.shop_id
  )
  res.json({ return_policies: policies })
}
