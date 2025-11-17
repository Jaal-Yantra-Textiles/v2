import { model } from "@medusajs/framework/utils"

const Mention = model.define("mention", {
  id: model.id().primaryKey(),
  username: model.text().searchable(),
  display_name: model.text().nullable(),
  platform: model.enum(["facebook", "instagram", "twitter"]),
  platform_user_id: model.text().nullable(),
  usage_count: model.number().default(0),
  last_used_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default Mention
