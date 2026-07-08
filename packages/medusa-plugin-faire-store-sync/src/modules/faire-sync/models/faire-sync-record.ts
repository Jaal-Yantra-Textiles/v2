import { model } from "@medusajs/framework/utils"

const FaireSyncRecord = model.define("faire_sync_record", {
  id: model.id().primaryKey(),
  product_id: model.text(),
  account_id: model.text(),
  product_token: model.text().nullable(),
  product_url: model.text().nullable(),
  product_state: model.text().nullable(),
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

export default FaireSyncRecord
