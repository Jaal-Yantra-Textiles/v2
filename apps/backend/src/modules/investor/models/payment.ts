import { model } from "@medusajs/framework/utils"
import Stake from "./stake"
import CallForShares from "./call-for-shares"

const Payment = model.define("investor_payment", {
  id: model.id().primaryKey(),

  stake: model.belongsTo(() => Stake, {
    mappedBy: "payments",
    optional: true,
  }),
  call_for_shares: model.belongsTo(() => CallForShares, {
    mappedBy: "payments",
    optional: true,
  }),

  investor_id: model.text().searchable(),
  company_id: model.text().searchable(),

  amount: model.bigNumber(),
  currency_code: model.text().nullable(),

  payment_type: model.enum([
    "subscription",
    "capital_call",
    "top_up",
    "transfer_fee",
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
