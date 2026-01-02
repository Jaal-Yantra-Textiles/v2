import { model } from "@medusajs/framework/utils"
import Form from "./form"

const FormField = model.define("form_field", {
  id: model.id({ prefix: "form_field" }).primaryKey(),

  form: model.belongsTo(() => Form, { mappedBy: "fields" }),

  name: model.text(),
  label: model.text(),
  type: model
    .enum([
      "text",
      "email",
      "textarea",
      "number",
      "select",
      "checkbox",
      "radio",
      "date",
      "phone",
      "url",
    ])
    .default("text"),

  required: model.boolean().default(false),
  placeholder: model.text().nullable(),
  help_text: model.text().nullable(),

  options: model.json().nullable(),
  validation: model.json().nullable(),

  order: model.number().default(0),

  metadata: model.json().nullable(),
})

export default FormField
