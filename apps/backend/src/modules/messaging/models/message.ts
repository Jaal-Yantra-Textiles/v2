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
    status: model.enum(["pending", "sent", "delivered", "read", "failed", "queued"]).default("sent"),
    context_type: model.text().nullable(),
    context_id: model.text().nullable(),
    context_snapshot: model.json().nullable(),
    /**
     * 🔴 For INBOUND WhatsApp media this starts as Meta's own
     * `lookaside.fbsbx.com` URL and is overwritten with OUR stored URL once
     * the bytes are downloaded. Meta's copy is useless to anyone but us: it
     * 401s without a bearer token and carries an `ext=` expiry about FIVE
     * MINUTES out. A row still holding a lookaside URL is a broken image, not
     * a photograph — see `media_id`.
     */
    media_url: model.text().nullable(),
    media_mime_type: model.text().nullable(),
    /**
     * Meta's media id, kept so a download that did not happen can still happen
     * later.
     *
     * Meta retains the bytes ~30 days, so an id is a 30-day claim on the
     * photograph while the URL beside it lives five minutes. Ten photographs
     * from Bhagalpur Handloom SHG were nearly lost because this column did not
     * exist: the id was recoverable only by regexing `mid=` out of a URL that
     * Meta is free to reshape at any time.
     */
    media_id: model.text().nullable(),
    /**
     * Set when media arrived but was deliberately NOT downloaded — today only
     * because the sender had not yet consented to the conversation being
     * recorded, and fetching their photographs first is the thing consent is
     * being asked about. Cleared when the backfill collects it.
     */
    media_pending_reason: model.text().nullable(),
    /**
     * The sender's OWN name for the file, as WhatsApp carries it.
     *
     * 🔴 Only a `document` has one. A photo sent from the gallery arrives as
     * `image`, which Meta strips of every filename — so "send it as a file,
     * not a photo" is a real instruction with a real consequence, not a
     * preference, and a partner who taps the wrong attach button produces a
     * row with nothing in this column.
     *
     * It exists because a photograph of cloth cannot be identified from the
     * cloth: six of GOF's eight invoice colours appear on two different
     * materials, so colour alone never decides which material a swatch belongs
     * to. The filename is the only channel by which the sender can TELL us,
     * short of a caption per photo.
     *
     * Kept verbatim, never parsed here. What a name means is a question for
     * whoever matches it to a material, and a normalised copy would be a
     * second version of a fact the sender owns.
     */
    media_filename: model.text().nullable(),
    reply_to_id: model.text().nullable(),
    reply_to_snapshot: model.json().nullable(),
    // Human-readable reason a delivery failed (Meta error code/title/message).
    // Set from the WhatsApp status webhook when status flips to "failed".
    fail_reason: model.text().nullable(),
    metadata: model.json().nullable(),
})

export default Message
