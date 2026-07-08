import { model } from "@medusajs/framework/utils"

const FaireSyncAccount = model.define("faire_sync_account", {
  id: model.id().primaryKey(),
  brand_id: model.text(),
  brand_name: model.text(),
  currency: model.text().nullable(),
  country: model.text().nullable(),
  access_token: model.text(),
  refresh_token: model.text().nullable(),
  token_expires_at: model.dateTime().nullable(),
  brand_info: model.json().nullable(),
  is_active: model.boolean().default(true),
})

export default FaireSyncAccount
