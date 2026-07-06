import { model } from "@medusajs/framework/utils"

/**
 * Durable record of an inbound Etsy webhook delivery. `webhook_id` is the Svix
 * delivery id Etsy sends in the `webhook-id` header — unique so retries (Etsy
 * retries with exponential backoff) are idempotent.
 */
const EtsyWebhookEvent = model.define("etsy_webhook_event", {
  id: model.id().primaryKey(),
  webhook_id: model.text().unique(),
  event_type: model.text(),
  shop_id: model.text().nullable(),
  resource_url: model.text().nullable(),
  payload: model.json().nullable(),
  resource: model.json().nullable(),
  processed: model.boolean().default(false),
  error: model.text().nullable(),
  received_at: model.dateTime().nullable(),
})

export default EtsyWebhookEvent
