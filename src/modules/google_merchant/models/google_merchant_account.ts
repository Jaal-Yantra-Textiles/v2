import { model } from "@medusajs/framework/utils"

const GoogleMerchantAccount = model.define("google_merchant_account", {
  id: model.id().primaryKey(),
  name: model.text(),
  merchant_id: model.text(),
  client_id: model.text(),
  client_secret: model.json(),
  redirect_uri: model.text(),
  scope: model.text().nullable(),
  access_token: model.text().nullable(),
  refresh_token: model.json().nullable(),
  token_expires_at: model.dateTime().nullable(),
  account_email: model.text().nullable(),
  is_active: model.boolean().default(false),
  api_config: model.json().nullable(),
})

export default GoogleMerchantAccount
