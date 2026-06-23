import { model } from "@medusajs/framework/utils"

/**
 * marketing_outreach — hand-crafted outbound (Winbacks / Exec) (#659 slice 1).
 * Powers slice 5 (WinbacksView). Honesty rule (report §6): bounce status is
 * unreliable, so `bounce_unreliable` flags it for a yellow warning rather than
 * silently suppressing the recipient.
 */
const MarketingOutreach = model
  .define("marketing_outreach", {
    id: model.id().primaryKey(),
    recipient_email: model.text(),
    recipient_name: model.text().nullable(),
    company: model.text().nullable(),
    status: model
      .enum(["queued", "sent", "opened", "replied", "bounced", "unknown"])
      .default("queued"),
    channel: model.enum(["email", "whatsapp", "manual"]).default("email"),
    campaign: model.text().nullable(), // free-text grouping ("q3-winbacks")
    sent_at: model.dateTime().nullable(),
    opened_at: model.dateTime().nullable(),
    replied_at: model.dateTime().nullable(),
    bounce_unreliable: model.boolean().default(false),
    notes: model.text().nullable(),
    external_id: model.text().nullable(), // provider message id for sync (slice 5)
  })
  .indexes([
    { on: ["recipient_email"] },
    { on: ["campaign"] },
    { on: ["status"] },
  ])

export default MarketingOutreach
