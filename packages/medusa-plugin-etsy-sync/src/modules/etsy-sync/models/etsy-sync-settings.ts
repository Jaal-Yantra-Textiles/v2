import { model } from "@medusajs/framework/utils"

const EtsySyncSettings = model.define("etsy_sync_settings", {
  id: model.id().primaryKey(),
  account_id: model.text().nullable(),
  default_taxonomy_id: model.number().nullable(),
  default_shipping_profile_id: model.text().nullable(),
  default_return_policy_id: model.text().nullable(),
  default_readiness_state_id: model.text().nullable(),
  default_who_made: model.text().default("i_did"),
  default_when_made: model.text().default("made_to_order"),
  default_is_supply: model.boolean().default(false),
  default_type: model.text().default("physical"),
  auto_publish: model.boolean().default(false),
  follow_product_status: model.boolean().default(true),
  pending_oauth: model.json().nullable(),
})

export default EtsySyncSettings
