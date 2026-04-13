import { model } from "@medusajs/framework/utils"
import Conversation from "./conversation"

const Message = model.define("messaging_message", {
    id: model.id().primaryKey(),
    conversation: model.belongsTo(() => Conversation, { mappedBy: "messages" }),
    direction: model.enum(["inbound", "outbound"]),
    sender_name: model.text().nullable(),
    content: model.text(),
    message_type: model.enum(["text", "interactive", "template", "media", "context_card"]).default("text"),
    wa_message_id: model.text().nullable(),
    status: model.enum(["pending", "sent", "delivered", "read", "failed"]).default("sent"),
    context_type: model.text().nullable(),
    context_id: model.text().nullable(),
    context_snapshot: model.json().nullable(),
    media_url: model.text().nullable(),
    media_mime_type: model.text().nullable(),
    reply_to_id: model.text().nullable(),
    reply_to_snapshot: model.json().nullable(),
    metadata: model.json().nullable(),
})

export default Message
