import { model } from "@medusajs/framework/utils";
import SocialPlatform from "./SocialPlatform"; // Import the related model

const SocialPost = model.define("SocialPost", {
  id: model.id().primaryKey(),
  post_url: model.text(),
  caption: model.text(),
  status: model.enum(["draft","scheduled","posted","failed","archived"]),
  scheduled_at: model.dateTime(),
  posted_at: model.dateTime(),
  insights: model.json(),
  media_attachments: model.json(),
  notes: model.text(),
  error_message: model.text(),
  related_item_type: model.text(),
  related_item_id: model.text(),
  platform: model.belongsTo(() => SocialPlatform, { foreignKey: "platform_id" }), // Added relationship
});

export default SocialPost;
