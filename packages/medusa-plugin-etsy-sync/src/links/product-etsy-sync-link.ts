import ProductModule from "@medusajs/medusa/product"
import EtsySyncModule from "../modules/etsy-sync"
import { defineLink } from "@medusajs/framework/utils"

/**
 * Link between Product and Etsy account, storing the *current* per-product
 * sync state. Historical sync attempts live in the etsy_sync_record table.
 *
 * extraColumns:
 * - etsy_listing_id: Etsy listing ID once created
 * - etsy_url: public Etsy listing URL
 * - sync_status: pending | synced | failed | out_of_sync
 * - last_synced_at: last successful sync
 * - sync_error: last error message
 */
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  {
    linkable: EtsySyncModule.linkable.etsySyncAccount,
    isList: false,
  },
  {
    database: {
      extraColumns: {
        etsy_listing_id: {
          type: "text",
          nullable: true,
        },
        etsy_url: {
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
