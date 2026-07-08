import { model } from "@medusajs/framework/utils"

/**
 * Durable record of an inbound Faire webhook delivery. `webhook_id` is the
 * delivery id Faire sends (unique) so retries are idempotent.
 */
const FaireWebhookEvent = model.define("faire_webhook_event", {
  id: model.id().primaryKey(),
  webhook_id: model.text().unique(),
  event_type: model.text(),
  brand_id: model.text().nullable(),
  resource_url: model.text().nullable(),
  payload: model.json().nullable(),
  resource: model.json().nullable(),
  processed: model.boolean().default(false),
  error: model.text().nullable(),
  received_at: model.dateTime().nullable(),
})

export default FaireWebhookEvent
