import { model } from "@medusajs/framework/utils";
import MediaFile from "./media_file";
import AlbumMedia from "./album-media";

const Album = model.define("album", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  description: model.text().nullable(),
  slug: model.text().unique(),
  is_public: model.boolean().default(true),
  sort_order: model.number().default(0),
  type: model.enum(["gallery", "portfolio", "product", "profile", "general"]).default("general"),
  metadata: model.json().nullable(),
  
  // Relationships
  cover_media: model.belongsTo(() => MediaFile, {
    mappedBy: "albums_as_cover",
  }),
  album_medias: model.hasMany(() => AlbumMedia, {
    mappedBy: "album",
  }),
  media_files: model.manyToMany(() => MediaFile, {
    pivotEntity: () => AlbumMedia,
  }),
});

export default Album;
