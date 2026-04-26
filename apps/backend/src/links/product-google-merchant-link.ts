import ProductModule from "@medusajs/medusa/product"
import GoogleMerchantModule from "../modules/google_merchant"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  {
    linkable: GoogleMerchantModule.linkable.googleMerchantAccount,
    isList: false,
  },
  {
    database: {
      extraColumns: {
        google_product_id: {
          type: "text",
          nullable: true,
        },
        google_product_name: {
          type: "text",
          nullable: true,
        },
        sync_status: {
          type: "text",
          defaultValue: "'pending'",
          nullable: false,
        },
        last_synced_at: {
          type: "datetime",
          nullable: true,
        },
        sync_error: {
          type: "text",
          nullable: true,
        },
        metadata: {
          type: "json",
          nullable: true,
        },
      },
    },
  }
)
