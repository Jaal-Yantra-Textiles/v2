import { model } from "@medusajs/framework/utils"

const EtsySyncRecord = model.define("etsy_sync_record", {
  id: model.id().primaryKey(),
  product_id: model.text(),
  account_id: model.text(),
  listing_id: model.text().nullable(),
  listing_url: model.text().nullable(),
  listing_state: model.text().nullable(),
  action: model.enum(["create", "update", "delete"]).default("create"),
  status: model
    .enum(["pending", "syncing", "success", "failed", "draft"])
    .default("pending"),
  published: model.boolean().default(false),
  error_message: model.text().nullable(),
  warnings: model.json().nullable(),
  metadata: model.json().nullable(),
  synced_at: model.dateTime().nullable(),
})

export default EtsySyncRecord
