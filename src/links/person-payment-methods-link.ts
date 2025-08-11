import { defineLink } from "@medusajs/framework/utils"
import PersonModule from "../modules/person"
import InternalPaymentModule from "../modules/internal_payments"

export default defineLink(
  { linkable: PersonModule.linkable.person, isList: true, field: "payment_methods" },
  { linkable: InternalPaymentModule.linkable.internalPaymentDetails, isList: true, field: "persons" }
)
