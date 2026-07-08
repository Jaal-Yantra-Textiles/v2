import ProductModule from "@medusajs/medusa/product"
import FaireSyncModule from "../modules/faire-sync"
import { defineLink } from "@medusajs/framework/utils"

/**
 * Link between Product and Faire account, storing the *current* per-product
 * sync state. Historical sync attempts live in the faire_sync_record table.
 *
 * extraColumns:
 * - faire_product_token: Faire product token once created
 * - faire_url: public Faire product URL
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
    linkable: FaireSyncModule.linkable.faireSyncAccount,
    isList: false,
  },
  {
    database: {
      extraColumns: {
        faire_product_token: {
          type: "text",
          nullable: true,
        },
        faire_url: {
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
