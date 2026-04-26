import { model } from "@medusajs/framework/utils";

const Etsy_sync_job = model.define("etsy_sync_job", {
  id: model.id().primaryKey(),
  transaction_id: model.text(),
  status: model.enum(["pending","confirmed","processing","completed","failed"]),
  total_products: model.number(),
  synced_count: model.number(),
  failed_count: model.number(),
  error_log: model.json(),
  started_at: model.dateTime(),
  completed_at: model.dateTime(),
});

export default Etsy_sync_job;
