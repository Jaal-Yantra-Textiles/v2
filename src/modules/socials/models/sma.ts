import { model } from "@medusajs/framework/utils";

const Sma = model.define("sma", {
  id: model.id().primaryKey(),
  platform: model.text(),
  access_token: model.text(),
});

export default Sma;
