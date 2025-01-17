import { model } from "@medusajs/framework/utils";
import Website from "./website";

const Page = model.define("page", {
  id: model.id().primaryKey(),
  title: model.text().searchable(),
  slug: model.text().unique(),
  content: model.text(),
  page_type: model.enum([
    "Home",
    "About",
    "Contact",
    "Blog",
    "Product",
    "Service",
    "Portfolio",
    "Landing",
    "Custom"
  ]).default("Custom"),
  status: model.enum([
    "Draft",
    "Published",
    "Archived"
  ]).default("Draft"),
  meta_title: model.text().nullable(),
  meta_description: model.text().nullable(),
  meta_keywords: model.text().nullable(),
  published_at: model.dateTime().nullable(),
  last_modified: model.dateTime(),
  metadata: model.json().nullable(),
  
  // Relationship with Website
  website: model.belongsTo(() => Website, { mappedBy: "pages" }),
});

export default Page;
