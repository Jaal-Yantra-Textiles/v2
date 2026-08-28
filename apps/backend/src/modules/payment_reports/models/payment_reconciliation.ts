import { model } from "@medusajs/framework/utils"

const PaymentReconciliation = model.define("payment_reconciliation", {
  id: model.id().primaryKey(),
  reference_type: model
    .enum(["payment_submission", "inventory_order", "manual"])
    .default("manual"),
  reference_id: model.text().nullable(),
  /**
   * WHERE THE MONEY CAME FROM — distinct from `reference_type`, which says what
   * record is being reconciled.
   *
   * 🔴 Two facts, two columns, deliberately. `reference_type` already offers an
   * `inventory_order` value, and overloading it to mean the source would leave
   * one column meaning "the submission" on some rows and "the order" on others
   * — the exact defect #1559 shipped, where `quantity` was a rate or a total
   * depending on a sibling column and a report told operators to corrupt
   * correct data.
   *
   * Mirrors `payment_submission_item.source_type`, so the vocabulary is the
   * same at both ends: design | task | run | inventory_order, plus `mixed`
   * for a submission whose lines do not agree — which is a real shape, not a
   * failure, and must not be silently reported as whichever line came first.
   */
  source_type: model.text().nullable(),
  source_id: model.text().nullable(),
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
