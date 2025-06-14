import { model } from "@medusajs/framework/utils";
import SocialPlatform from "./SocialPlatform"; // Import the related model

const SocialPost = model.define("SocialPost", {
  id: model.id().primaryKey(),
  post_url: model.text().nullable(),
  caption: model.text().nullable(),
  status: model.enum(["draft","scheduled","posted","failed","archived"]),
  scheduled_at: model.dateTime().nullable(),
  posted_at: model.dateTime().nullable(),
  insights: model.json().nullable(),
  media_attachments: model.json().nullable(),
  notes: model.text().nullable(),
  error_message: model.text().nullable(),
  related_item_type: model.text().nullable(),
  related_item_id: model.text().nullable(),
  platform: model.belongsTo(() => SocialPlatform, { foreignKey: "platform_id" }), // Added relationship
});

export default SocialPost;
