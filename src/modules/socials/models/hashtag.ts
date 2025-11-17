import { model } from "@medusajs/framework/utils"

const Hashtag = model.define("hashtag", {
  id: model.id().primaryKey(),
  tag: model.text().searchable(),
  platform: model.enum(["facebook", "instagram", "twitter", "all"]).default("all"),
  usage_count: model.number().default(0),
  last_used_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default Hashtag
