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
    // SocialPlatform.id of the WhatsApp number used for this conversation.
    // Set on inbound creation (from webhook's metadata.phone_number_id) and
    // settable by an admin to pin replies to a specific sender. Null means
    // "use the default WhatsApp platform", preserving legacy behavior.
    default_sender_platform_id: model.text().nullable(),
    metadata: model.json().nullable(),

    messages: model.hasMany(() => Message, { mappedBy: "conversation" }),
}).cascades({
    delete: ["messages"],
})

export default Conversation
