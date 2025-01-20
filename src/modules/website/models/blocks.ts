import { model } from "@medusajs/framework/utils";
import Page from "./page";

const UNIQUE_BLOCKS = [
    "Hero",
    "Header",
    "Footer",
    "MainContent",
    "ContactForm"
  ];
  
  const REPEATABLE_BLOCKS = [
    "Feature",
    "Gallery",
    "Testimonial",
    "Product",
    "Section",
    "Custom"
  ];

const Block = model.define("block", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  type: model.enum([
    ...UNIQUE_BLOCKS,
    ...REPEATABLE_BLOCKS
  ]).default("Content"),
  content: model.json(), // Flexible JSON structure for different block types
  settings: model.json().nullable(), // Block-specific settings (e.g., layout, styling)
  order: model.number().default(0), // For arranging blocks in order
  status: model.enum([
    "Active",
    "Inactive",
    "Draft"
  ]).default("Active"),
  
  // Relationship with Page
  page: model.belongsTo(() => Page),
  metadata: model.json().nullable(),
}).indexes([

    {
        name: "unique_block_type_per_page",
        on: ["page_id", "type"],
        unique: true,
        where: `type IN ('Hero', 'Header', 'Footer', 'MainContent', 'ContactForm')`
      }
    
])

export default Block