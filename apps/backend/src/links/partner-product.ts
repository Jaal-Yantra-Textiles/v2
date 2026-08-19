import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import ProductModule from "@medusajs/medusa/product"

// #859 S2 (#861): partner ↔ product ownership link for the artisan quasi-partner
// flow. A `core_channel_listing` partner proposes a product (status=proposed);
// this link lets the cross-list subscriber resolve product → owning partner
// cleanly on publish (instead of the fragile product → sales_channel → store →
// partner multi-hop). One partner owns many products; a product has one owner.
//
// The extra columns record HOW the product came to be owned, not just that it
// is. An admin can now create a product directly into a partner's store on
// their behalf, and a product appearing in someone's live shop that they did
// not create is exactly the thing that must not be reconstructed later from a
// timestamp and a guess. Provenance belongs on the ownership record itself —
// stamping it into product `metadata` would put an audit fact in a junk drawer
// that anything may overwrite.
//
// All columns are nullable: rows written before this existed have genuinely
// unknown provenance, and NULL is the honest answer for them. `created_on_behalf`
// is the one flag readers actually branch on — false/NULL means the owner made
// it themselves.
export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
    field: "products",
  },
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  {
    database: {
      extraColumns: {
        /** "admin" | "partner" — which kind of actor performed the create. */
        created_by_actor_type: { type: "text", nullable: true },
        /** The acting user/partner-admin id, so the act is attributable. */
        created_by_actor_id: { type: "text", nullable: true },
        /**
         * TRUE only when someone other than the owner created it for them.
         * The flag readers branch on; keeping it explicit means a consumer
         * never has to infer intent from actor_type.
         */
        created_on_behalf: { type: "boolean", nullable: true },
        /** Which of the partner's stores it was created into. */
        store_id: { type: "text", nullable: true },
        /** Route/surface that wrote it, e.g. "admin_store_products". */
        source: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)
