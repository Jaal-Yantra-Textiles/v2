import { model } from "@medusajs/framework/utils";
import Album from "./album";
import MediaFile from "./media_file";

const AlbumMedia = model.define("album_media", {
  id: model.id().primaryKey(),
  
  // Organization within album
  sort_order: model.number().default(0),
  
  // Additional metadata for album-specific context
  title: model.text().nullable(),
  description: model.text().nullable(),
  
  // Relationships
  album: model.belongsTo(() => Album, {
    mappedBy: "album_medias",
  }),
  media: model.belongsTo(() => MediaFile, {
    mappedBy: "album_medias",
  }),
});

export default AlbumMedia;
