import { model } from "@medusajs/framework/utils"

const FaireSyncBatch = model.define("faire_sync_batch", {
  id: model.id().primaryKey(),
  transaction_id: model.text().nullable(),
  status: model
    .enum(["pending", "processing", "completed", "failed"])
    .default("pending"),
  total_products: model.number().default(0),
  synced_count: model.number().default(0),
  failed_count: model.number().default(0),
  error_log: model.json().nullable(),
  started_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),
})

export default FaireSyncBatch
