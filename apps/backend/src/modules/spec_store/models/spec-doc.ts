import { model } from "@medusajs/framework/utils"

const SpecDoc = model
  .define("spec_doc", {
    id: model.id({ prefix: "spec" }).primaryKey(),
    module_name: model.text().searchable(),
    spec_type: model.enum(["module", "links", "relations", "route_plans"]).default("module"),
    content: model.json(),
    version: model.text().nullable(),
    generated_at: model.dateTime(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["module_name", "spec_type"],
      unique: true,
    },
    {
      on: ["spec_type"],
    },
  ])

export default SpecDoc
