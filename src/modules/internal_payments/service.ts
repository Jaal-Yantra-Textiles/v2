import { MedusaService } from "@medusajs/framework/utils";
import Payment from "./models/payment";
import PaymentDetails from "./models/payment_details";

class InternalPaymentService extends MedusaService({
  Payment,
  PaymentDetails,
}) {
  constructor() {
    super(...arguments)
  }
}

export default InternalPaymentService;
