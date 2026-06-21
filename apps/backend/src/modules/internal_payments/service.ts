import { MedusaService } from "@medusajs/framework/utils";
import Payment from "./models/payment";
import PaymentDetail from "./models/payment_details";
import PaymentAttachment from "./models/payment_attachment";

class InternalPaymentService extends MedusaService({
  Payment,
  PaymentDetail,
  PaymentAttachment,
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
