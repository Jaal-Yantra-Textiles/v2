import { model } from "@medusajs/framework/utils"
import Investor from "./investor"

const InvestorAdmin = model.define("investor_admin", {
  id: model.id().primaryKey(),

  first_name: model.text().searchable(),
  last_name: model.text().searchable(),
  email: model.text().unique().searchable(),
  phone: model.text().nullable(),

  preferred_language: model.text().nullable(),

  password_hash: model.text().nullable(),
  is_active: model.boolean().default(true),
  last_login: model.dateTime().nullable(),

  investor: model.belongsTo(() => Investor, {
    mappedBy: "admins",
  }),

  role: model.enum(["owner", "admin", "viewer"]).default("admin"),
  permissions: model.json().nullable(),

  metadata: model.json().nullable(),
})

export default InvestorAdmin
