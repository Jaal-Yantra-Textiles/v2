import { MedusaService } from "@medusajs/framework/utils";
import Payment from "./models/payment";
import PaymentDetail from "./models/payment_details";
import PaymentAttachment from "./models/payment_attachment";
import PartnerCredit from "./models/partner_credit";

class InternalPaymentService extends MedusaService({
  Payment,
  PaymentDetail,
  PaymentAttachment,
  PartnerCredit,
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
