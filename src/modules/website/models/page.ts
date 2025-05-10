import { model } from "@medusajs/framework/utils";
import Website from "./website";
import Block  from "./blocks";

const Page = model.define("page", {
  id: model.id().primaryKey(),
  title: model.text().searchable(),
  slug: model.text(),
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

  // Add public_metadata related stuff

  public_metadata: model.json().nullable(),

  sent_to_subscribers: model.boolean().default(false),
  sent_to_subscribers_at: model.dateTime().nullable(),
  subscriber_count: model.number().nullable(),
  
  // Relationship with Website
  website: model.belongsTo(() => Website, { mappedBy: "pages" }),
  // Relationship with blocks
  blocks: model.hasMany(() => Block),
}).cascades({
  delete: ['blocks'],
}).indexes([
  {
    on: ["slug", "website_id"],
    unique: true,
  },
])


export default Page;
