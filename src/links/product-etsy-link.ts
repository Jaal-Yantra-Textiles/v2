import ProductModule from "@medusajs/medusa/product"
import EtsysyncModule from "../modules/etsysync"
import { defineLink } from "@medusajs/framework/utils"

/**
 * Link between Product and Etsy Account with sync status tracking.
 * 
 * The extraColumns store per-product Etsy listing information:
 * - etsy_listing_id: The Etsy listing ID
 * - etsy_url: Public Etsy listing URL
 * - sync_status: Current sync state (pending, synced, failed, out_of_sync)
 * - last_synced_at: Timestamp of last successful sync
 * - sync_error: Error message if sync failed
 * - metadata: Additional sync metadata
 */
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true, // One product can have multiple Etsy listings (different shops)
  },
  {
    linkable: EtsysyncModule.linkable.etsyAccount,
    isList: false, // Each link is to one specific Etsy account
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
