import { model } from "@medusajs/framework/utils"
import FormField from "./form-field"
import FormResponse from "./form-response"

const Form = model
  .define("form", {
    id: model.id({ prefix: "form" }).primaryKey(),

    website_id: model.text().nullable(),
    domain: model.text().nullable(),

    handle: model.text(),
    title: model.text().searchable(),
    description: model.text().nullable(),

    status: model.enum(["draft", "published", "archived"]).default("draft"),

    submit_label: model.text().nullable(),
    success_message: model.text().nullable(),

    settings: model.json().nullable(),
    metadata: model.json().nullable(),

    fields: model.hasMany(() => FormField, { mappedBy: "form" }),
    responses: model.hasMany(() => FormResponse, { mappedBy: "form" }),
  })
  .cascades({
    delete: ["fields", "responses"],
  })
  .indexes([
    {
      on: ["handle", "website_id"],
      unique: true,
    },
    {
      on: ["domain", "handle"],
      unique: true,
    },
    {
      on: ["domain"],
    },
    {
      on: ["website_id"],
    },
  ])

export default Form
