import { model } from "@medusajs/framework/utils"

const EmailTemplate = model.define("email_template", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  description: model.text().nullable(),
  to: model.text().nullable(),
  cc: model.text().nullable(),
  bcc: model.text().nullable(),
  from: model.text().default("no-reply@jyt.com"),
  template_key: model.text(),
  subject: model.text(),
  html_content: model.text(),
  variables: model.json().nullable(),
  is_active: model.boolean().default(true),
  template_type: model.text().default("general"),
})

export default EmailTemplate
