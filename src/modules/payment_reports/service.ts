import Payment_report from "./models/payment_report";
import { MedusaService } from "@medusajs/framework/utils";
// Import your models here, e.g.:
// import MyModel from "./models/MyModel";

class Payment_reportsService extends MedusaService({
  Payment_report,
  // Register your models here, e.g.:
  // MyModel,
}) {
  constructor() {
    super(...arguments)
  }
}

export default Payment_reportsService;
