import { model } from "@medusajs/framework/utils"
import Stake from "./stake"
import CallForShares from "./call-for-shares"
import Convertible from "./convertible"

const Payment = model.define("investor_payment", {
  id: model.id().primaryKey(),

  stake: model.belongsTo(() => Stake, {
    mappedBy: "payments",
  }).nullable(),
  call_for_shares: model.belongsTo(() => CallForShares, {
    mappedBy: "payments",
  }).nullable(),
  convertible: model.belongsTo(() => Convertible, {
    mappedBy: "payments",
  }).nullable(),

  investor_id: model.text().searchable(),
  company_id: model.text().searchable(),

  amount: model.bigNumber(),
  currency_code: model.text().nullable(),

  payment_type: model.enum([
    "subscription",
    "capital_call",
    "top_up",
    "transfer_fee",
    "convertible",
    "other",
  ]).default("subscription"),

  status: model.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "refunded",
    "cancelled",
  ]).default("pending"),

  method: model.enum(["bank_transfer", "card", "upi", "wallet", "cheque", "other"]).nullable(),

  reference_number: model.text().nullable(),
  transaction_id: model.text().nullable(),

  due_date: model.dateTime().nullable(),
  paid_date: model.dateTime().nullable(),

  notes: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default Payment
