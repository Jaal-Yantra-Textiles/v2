import { model } from "@medusajs/framework/utils"

/**
 * A partner's push notification token — one row per (partner, device).
 *
 * iOS stores the APNs device token (64 hex chars); Android stores the FCM
 * registration token. Both arrive through `POST /partners/device-tokens`,
 * which upserts, so a re-registering app (token rotation, reinstall) never
 * leaves a stale row behind for the same device.
 *
 * `partner_id` here is the platform partner id (`partner_...`) — the same id
 * the notification rows carry on `receiver_id`, which is what the push
 * provider joins on.
 *
 * created_at/updated_at are DML-automatic — not declared here.
 */
const PartnerPushToken = model.define("partner_push_token", {
  id: model.id({ prefix: "pptok" }).primaryKey(),
  partner_id: model.text(),
  token: model.text(),
  platform: model.enum(["ios", "android"]).default("ios"),
  app_version: model.text().nullable(),
}).indexes([
  {
    on: ["partner_id"],
    name: "idx_partner_push_token_partner_id",
  },
  {
    on: ["partner_id", "token"],
    name: "idx_partner_push_token_partner_token",
  },
])

export default PartnerPushToken
