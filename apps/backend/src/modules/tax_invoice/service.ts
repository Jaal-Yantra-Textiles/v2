import { MedusaService } from "@medusajs/framework/utils"
import TaxInvoice from "./models/tax-invoice"

class TaxInvoiceService extends MedusaService({
  TaxInvoice,
}) {
  constructor() {
    super(...arguments)
  }
}

export default TaxInvoiceService
