import { model } from "@medusajs/framework/utils"
import MediaFile from "./media_file"

const MediaComment = model.define("media_comment", {
  id: model.id().primaryKey(),

  // Comment content
  content: model.text(),

  // Who commented
  author_type: model.enum(["partner", "admin"]),
  author_id: model.text(),
  author_name: model.text(),

  // Relationships
  media_file: model.belongsTo(() => MediaFile, {
    mappedBy: "comments",
  }),

  metadata: model.json().nullable(),
})

export default MediaComment
