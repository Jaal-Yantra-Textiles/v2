import { MedusaService } from "@medusajs/framework/utils"
import GoogleMerchantAccount from "./models/google_merchant_account"
import GoogleMerchantSyncJob from "./models/google_merchant_sync_job"

class GoogleMerchantService extends MedusaService({
  GoogleMerchantAccount,
  GoogleMerchantSyncJob,
}) {
  constructor() {
    super(...arguments)
  }
}

export default GoogleMerchantService
