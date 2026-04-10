import { model } from "@medusajs/framework/utils"
import Message from "./message"

const Conversation = model.define("messaging_conversation", {
    id: model.id().primaryKey(),
    partner_id: model.text(),
    title: model.text().nullable(),
    phone_number: model.text(),
    last_message_at: model.dateTime().nullable(),
    unread_count: model.number().default(0),
    status: model.enum(["active", "archived"]).default("active"),
    metadata: model.json().nullable(),

    messages: model.hasMany(() => Message, { mappedBy: "conversation" }),
}).cascades({
    delete: ["messages"],
})

export default Conversation
