import InternalPaymentModule from "../modules/internal_payments"
import PersonModule from "../modules/person"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: PersonModule.linkable.person, isList: true },
  { linkable: InternalPaymentModule.linkable.internalPayments, isList: true, field: 'payments' }
)