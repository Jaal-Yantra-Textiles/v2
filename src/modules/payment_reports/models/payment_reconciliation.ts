import { model } from "@medusajs/framework/utils"

const PaymentReconciliation = model.define("payment_reconciliation", {
  id: model.id().primaryKey(),
  reference_type: model
    .enum(["payment_submission", "inventory_order", "manual"])
    .default("manual"),
  reference_id: model.text().nullable(),
  partner_id: model.text().nullable(),
  expected_amount: model.bigNumber(),
  actual_amount: model.bigNumber().nullable(),
  discrepancy: model.bigNumber().nullable(),
  status: model
    .enum(["Pending", "Matched", "Discrepant", "Settled", "Waived"])
    .default("Pending"),
  payment_id: model.text().nullable(),
  settled_at: model.dateTime().nullable(),
  settled_by: model.text().nullable(),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default PaymentReconciliation
