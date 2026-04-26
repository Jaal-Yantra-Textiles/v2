import { model } from "@medusajs/framework/utils"

const EmailUsage = model.define("email_usage", {
  id: model.id().primaryKey(),
  provider: model.text(), // "resend" | "mailjet"
  date: model.text(), // YYYY-MM-DD format for daily tracking
  count: model.number().default(0),
})

export default EmailUsage
