import { model } from "@medusajs/framework/utils"

const EmailQueue = model.define("email_queue", {
  id: model.id().primaryKey(),
  to_email: model.text(),
  channel: model.text(), // "email" | "email_bulk"
  template: model.text(),
  data: model.text(), // JSON-serialized email payload
  status: model.enum(["pending", "processing", "sent", "failed"]).default("pending"),
  scheduled_for: model.text(), // YYYY-MM-DD — the date this should be sent
  attempts: model.number().default(0),
  last_error: model.text().nullable(),
})

export default EmailQueue
