import { model } from "@medusajs/framework/utils"
import InvestorAdmin from "./investor-admin"
import Stake from "./stake"
import Convertible from "./convertible"
import Pipeline from "./pipeline"

const Investor = model.define("investor", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  handle: model.text().unique().searchable(),
  logo: model.text().nullable(),

  status: model.enum(["active", "inactive", "pending"]).default("pending"),
  is_verified: model.boolean().default(false),

  workspace_type: model.enum(["investor"]).default("investor"),

  email: model.text().unique().searchable(),
  phone: model.text().nullable(),

  legal_name: model.text().nullable(),
  tax_id: model.text().nullable(),
  tax_id_type: model.text().nullable(),
  country_code: model.text().nullable(),
  currency_code: model.text().nullable(),

  investor_type: model.enum(["individual", "entity", "fund"]).default("individual"),

  wallet_address: model.text().nullable(),
  bank_account_ref: model.text().nullable(),

  // KYC / identity verification
  pan_number: model.text().nullable(),
  aadhar_number: model.text().nullable(),
  international_id_number: model.text().nullable(),
  id_type: model.enum(["pan", "aadhar", "international"]).nullable(),

  admins: model.hasMany(() => InvestorAdmin),
  stakes: model.hasMany(() => Stake),
  convertibles: model.hasMany(() => Convertible),
  pipeline: model.hasMany(() => Pipeline),

  metadata: model.json().nullable(),
})

export default Investor
