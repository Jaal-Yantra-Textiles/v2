import { model } from "@medusajs/framework/utils";
import Folder from "./folder";
import AlbumMedia from "./album-media";
import Album from "./album";

const MediaFile = model.define("media_file", {
  id: model.id().primaryKey(),
  
  // File information
  file_name: model.text().searchable(),
  original_name: model.text(),
  file_path: model.text(),
  file_size: model.number(),
  file_hash: model.text().nullable(),
  
  // Media type and format
  file_type: model.enum(["image", "video", "audio", "document", "archive", "other"]),
  mime_type: model.text(),
  extension: model.text(),
  
  // Dimensions and properties
  width: model.number().nullable(),
  height: model.number().nullable(),
  duration: model.number().nullable(), // for audio/video
  
  // Content information
  title: model.text().nullable(),
  description: model.text().nullable(),
  alt_text: model.text().nullable(),
  caption: model.text().nullable(),
  
  // Organization and access
  folder_path: model.text().default("/"),
  tags: model.json().nullable(),
  is_public: model.boolean().default(true),
  
  // Metadata and additional properties
  metadata: model.json().nullable(),
  
  // Relationships
  folder: model.belongsTo(() => Folder, {
    mappedBy: "media_files",
  }).nullable(),
  album_medias: model.hasMany(() => AlbumMedia, {
    mappedBy: "media",
  }),
  albums: model.manyToMany(() => Album, {
    pivotEntity: () => AlbumMedia,
  }),
  albums_as_cover: model.hasMany(() => Album, {
    mappedBy: "cover_media",
  }),
});

export default MediaFile;
