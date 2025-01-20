import { model } from "@medusajs/framework/utils";
import Page from "./page";

const Website = model.define("website", {
  id: model.id().primaryKey(),
  domain: model.text().unique(),
  name: model.text().searchable(),
  description: model.text().nullable(),
  status: model.enum([
    "Active",
    "Inactive",
    "Maintenance",
    "Development"
  ]).default("Development"),
  primary_language: model.text().default("en"),
  supported_languages: model.json().nullable(),
  favicon_url: model.text().nullable(),
  analytics_id: model.text().nullable(),
  metadata: model.json().nullable(),
  
  // Relationship with Pages
  pages: model.hasMany(() => Page),
})
.cascades(
  {
    delete: ['pages']
  }
)

export default Website;
