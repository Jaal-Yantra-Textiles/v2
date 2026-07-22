import { model } from "@medusajs/framework/utils"

/**
 * Audit row for a Kit (kit.com) broadcast we created off a blog page.
 *
 * Kit fans the actual send out on its side; we keep this row to link our
 * `page_id` to the Kit `broadcast_id` so the stats poller
 * (`GET /v4/broadcasts/{id}/stats`) can fold opens/clicks back in later, and so
 * an operator can trace which broadcast a page produced.
 */
const KitBroadcast = model.define("kit_broadcast", {
  id: model.id().primaryKey(),
  // The website page (blog post) this broadcast was sent for.
  page_id: model.text(),
  // Kit's broadcast id (as returned by POST /v4/broadcasts).
  kit_broadcast_id: model.text(),
  // Number of subscribers synced + tagged for this send (our count, pre-send).
  recipient_count: model.number().default(0),
  // When we told Kit to send (send_at).
  sent_at: model.dateTime().nullable(),
  // Last polled Kit stats snapshot (recipients/opens/clicks). Nullable — filled
  // by the stats poller, not at create time.
  stats: model.json().nullable(),
})

export default KitBroadcast
