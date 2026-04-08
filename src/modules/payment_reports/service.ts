import Payment_report from "./models/payment_report";
import PaymentReconciliation from "./models/payment_reconciliation";
import { MedusaService } from "@medusajs/framework/utils";

class Payment_reportsService extends MedusaService({
  Payment_report,
  PaymentReconciliation,
}) {
  constructor() {
    super(...arguments)
  }
}

export default Payment_reportsService;
