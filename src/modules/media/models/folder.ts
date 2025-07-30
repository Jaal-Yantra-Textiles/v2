import { model } from "@medusajs/framework/utils";
import MediaFile from "./media_file";

const Folder = model.define("folder", {
  id: model.id().primaryKey(),
  
  // Basic information
  name: model.text().searchable(),
  slug: model.text().unique(),
  description: model.text().nullable(),
  
  // Hierarchical structure
  path: model.text(), // Full path like "/images/products/2024"
  level: model.number().default(0),
  
  // Organization
  sort_order: model.number().default(0),
  is_public: model.boolean().default(true),
  
  // Additional metadata
  metadata: model.json().nullable(),
  
  // Relationships
  parent_folder: model.belongsTo(() => Folder, {
    mappedBy: "child_folders",
  }),
  child_folders: model.hasMany(() => Folder, {
    mappedBy: "parent_folder",
  }),
  media_files: model.hasMany(() => MediaFile, {
    mappedBy: "folder",
  }),
});

export default Folder;
