import { model } from "@medusajs/framework/utils";
import SocialPost from "./SocialPost"; // Import the related model

const SocialPlatform = model.define("SocialPlatform", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  icon_url: model.text().nullable(),
  base_url: model.text().nullable(),
  api_config: model.json().nullable(),
  posts: model.hasMany(() => SocialPost, { mappedBy: "platform" }), // Added relationship
});

export default SocialPlatform;
