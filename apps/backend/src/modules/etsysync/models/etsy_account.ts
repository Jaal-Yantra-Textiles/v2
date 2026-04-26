import { model } from "@medusajs/framework/utils";

const Etsy_account = model.define("etsy_account", {
  id: model.id().primaryKey(),
  shop_id: model.text(),
  shop_name: model.text(),
  access_token: model.text(),
  refresh_token: model.text(),
  token_expires_at: model.dateTime(),
  api_config: model.json(),
  is_active: model.boolean(),
});

export default Etsy_account;
