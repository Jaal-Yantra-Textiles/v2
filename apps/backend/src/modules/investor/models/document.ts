import { model } from "@medusajs/framework/utils"
import CapTable from "./cap-table"
import CallForShares from "./call-for-shares"

const Document = model.define("investor_document", {
  id: model.id().primaryKey(),

  cap_table: model.belongsTo(() => CapTable, {
    mappedBy: "documents",
  }).nullable(),
  call_for_shares: model.belongsTo(() => CallForShares, {
    mappedBy: "documents",
  }).nullable(),

  investor_id: model.text().nullable(),
  company_id: model.text().searchable(),

  title: model.text().searchable(),
  description: model.text().nullable(),

  document_type: model.enum([
    "share_certificate",
    "subscription_agreement",
    "term_sheet",
    "sha",
    "financial_statement",
    "pitch_deck",
    "kyc",
    "legal",
    "other",
  ]).default("other"),

  file_key: model.text(),
  file_url: model.text().nullable(),
  file_name: model.text().nullable(),
  file_size: model.number().nullable(),
  mime_type: model.text().nullable(),

  visibility: model.enum(["private", "investor", "public"]).default("investor"),

  uploaded_by: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default Document
