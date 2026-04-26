import { model } from "@medusajs/framework/utils"
import Form from "./form"

const FormResponse = model
  .define("form_response", {
    id: model.id({ prefix: "form_resp" }).primaryKey(),

    form: model.belongsTo(() => Form, { mappedBy: "responses" }),

    status: model
      .enum(["new", "read", "archived", "pending_verification"])
      .default("new"),

    email: model.text().nullable(),
    data: model.json(),

    submitted_at: model.dateTime(),

    verification_code: model.text().nullable(),
    verification_expires_at: model.dateTime().nullable(),

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
    {
      on: ["verification_code", "form_id"],
    },
  ])

export default FormResponse
