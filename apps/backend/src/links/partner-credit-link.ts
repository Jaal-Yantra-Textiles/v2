import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import InternalPaymentModule from "../modules/internal_payments"

/**
 * Whose credit this is (#1712). A credit with no owner is unusable — the
 * partner ledger is reached BY partner, and `internal_payments` has no partner
 * column, which is exactly why payments needed `partner-payments-link`.
 */
export default defineLink(
  PartnerModule.linkable.partner,
  {
    linkable: InternalPaymentModule.linkable.partnerCredit,
    isList: true,
    field: "credits",
  }
)
