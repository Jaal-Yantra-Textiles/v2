import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../../../../../modules/faire-sync"
import FaireSyncService from "../../../../../modules/faire-sync/service"

// POST /admin/faire/auth/api-key — connect a Faire account in API-key
// (single-merchant) mode. Body: { access_token }. Fetches the brand profile
// with the supplied token and persists the account.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { access_token } = req.body as { access_token?: string }
  if (!access_token) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "access_token is required"
    )
  }

  const service: FaireSyncService = req.scope.resolve(FAIRE_SYNC_MODULE)
  const { account, brand } = await service.connectWithApiKey(access_token)

  res.json({
    account: {
      id: (account as any).id,
      brand_id: (account as any).brand_id,
      brand_name: (account as any).brand_name,
    },
    brand,
  })
}
