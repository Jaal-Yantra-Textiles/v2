import { model } from "@medusajs/framework/utils"

const InboundEmail = model.define("inbound_email", {
  id: model.id({ prefix: "inb_email" }).primaryKey(),
  imap_uid: model.text(),
  message_id: model.text().nullable(),
  from_address: model.text().searchable(),
  to_addresses: model.json(),
  subject: model.text().searchable(),
  html_body: model.text(),
  text_body: model.text().nullable(),
  folder: model.text(),
  received_at: model.dateTime(),
  status: model
    .enum(["received", "action_pending", "processed", "ignored"])
    .default("received"),
  action_type: model.text().nullable(),
  action_result: model.json().nullable(),
  extracted_data: model.json().nullable(),
  error_message: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default InboundEmail
