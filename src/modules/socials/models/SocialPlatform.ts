import { model } from "@medusajs/framework/utils";
import SocialPost from "./SocialPost"; // Import the related model

const SocialPlatform = model.define("SocialPlatform", {
  id: model.id().primaryKey(),
  name: model.text().searchable(), // Made name searchable
  icon_url: model.text(),
  base_url: model.text(),
  api_config: model.json(),
  posts: model.hasMany(() => SocialPost, { mappedBy: "platform" }), // Added relationship
});

export default SocialPlatform;
