import { MedusaService } from "@medusajs/framework/utils";
import Payment from "./models/payment";
import PaymentDetail from "./models/payment_details";

class InternalPaymentService extends MedusaService({
  Payment,
  PaymentDetail,
}) {
  constructor() {
    super(...arguments)
  }
  async listInternalPaymentDetails(...args) {
    return this.listPaymentDetails(...args)
  }

  async listInternalPayments(...args) {
    return this.listPayments(...args)
  }
    
}

export default InternalPaymentService;
