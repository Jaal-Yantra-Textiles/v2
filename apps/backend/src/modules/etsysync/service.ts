import Etsy_sync_job from "./models/etsy_sync_job";
import Etsy_account from "./models/etsy_account";
import { MedusaService } from "@medusajs/framework/utils";
// Import your models here, e.g.:
// import MyModel from "./models/MyModel";

class EtsysyncService extends MedusaService({
  Etsy_sync_job,
  Etsy_account,
  // Register your models here, e.g.:
  // MyModel,
}) {
  constructor() {
    super(...arguments)
  }
}

export default EtsysyncService;
