import { model } from "@medusajs/framework/utils"
import Page from "./page"

const SubscriptionSendLog = model.define("subscription_send_log", {
  id: model.id().primaryKey(),
  page: model.belongsTo(() => Page, { mappedBy: "subscription_send_logs" }),
  subscriber_id: model.text(),
  subscriber_email: model.text(),
  provider: model.text().nullable(), // "resend" | "mailjet" | null
  status: model
    .enum(["sent", "failed", "queued", "retried"])
    .default("sent"),
  error: model.text().nullable(),
  sent_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
}).indexes([
  {
    on: ["page_id"],
    name: "IDX_subscription_send_log_page_id",
  },
  {
    on: ["subscriber_email"],
    name: "IDX_subscription_send_log_email",
  },
  {
    on: ["status"],
    name: "IDX_subscription_send_log_status",
  },
])

export default SubscriptionSendLog
