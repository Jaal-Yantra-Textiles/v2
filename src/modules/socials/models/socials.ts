import { model } from "@medusajs/framework/utils";

const Socials = model.define("socials", {
  id: model.id().primaryKey(),
  // TODO: Add model properties here
  // Example:
  // name: model.text().searchable(),
});

export default Socials;
