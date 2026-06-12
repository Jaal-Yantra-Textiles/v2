import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import OrderModule from "@medusajs/medusa/order"

// D3 (#342): partner ↔ core order scoping link for unified work-orders
// (order.metadata.kind = design | inventory). Retail orders keep using
// sales-channel scoping; work-orders need an explicit link because a partner
// can serve another partner's store.
export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
  },
  {
    linkable: OrderModule.linkable.order,
    isList: true,
  }
)
