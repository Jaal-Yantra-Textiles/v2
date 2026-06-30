import { model } from "@medusajs/framework/utils"

const EtsySyncAccount = model.define("etsy_sync_account", {
  id: model.id().primaryKey(),
  shop_id: model.text(),
  shop_name: model.text(),
  user_id: model.text().nullable(),
  shop_url: model.text().nullable(),
  currency: model.text().nullable(),
  access_token: model.text(),
  refresh_token: model.text(),
  token_expires_at: model.dateTime(),
  shop_info: model.json().nullable(),
  is_active: model.boolean().default(true),
})

export default EtsySyncAccount
