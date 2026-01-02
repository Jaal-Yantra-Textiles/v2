import { model } from "@medusajs/framework/utils"
import Form from "./form"

const FormResponse = model
  .define("form_response", {
    id: model.id({ prefix: "form_resp" }).primaryKey(),

    form: model.belongsTo(() => Form, { mappedBy: "responses" }),

    status: model.enum(["new", "read", "archived"]).default("new"),

    email: model.text().nullable(),
    data: model.json(),

    submitted_at: model.dateTime(),

    page_url: model.text().nullable(),
    referrer: model.text().nullable(),
    ip: model.text().nullable(),
    user_agent: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["form_id"],
    },
    {
      on: ["email"],
    },
    {
      on: ["submitted_at"],
    },
    {
      on: ["status"],
    },
  ])

export default FormResponse
