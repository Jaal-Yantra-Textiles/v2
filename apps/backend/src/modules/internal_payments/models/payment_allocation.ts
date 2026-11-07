import { model } from "@medusajs/framework/utils"

/**
 * How much of ONE payment goes to ONE payout (#2523).
 *
 * The payment ↔ payout LINK says "this payment pays this payout". It carries no
 * amount, so a payment linked to several payouts was split by the fold alone,
 * oldest payout first (#1712). That is right when nobody said otherwise, and
 * wrong when the founder paid 25,000 "16,380 for the old bill, the rest for the
 * new parcel".
 *
 * A row here is the founder's stated share. The fold spends these first, then
 * falls back to oldest-first for links with no row, so every payment linked
 * before this model existed reads exactly as it did.
 *
 * 🔑 The link stays the source of WHETHER a payment pays a payout; this row
 * only says HOW MUCH. An allocation whose link was removed is ignored by the
 * fold, never treated as a link of its own.
 *
 * Not an extra column on the link. Medusa abbreviates that table's name
 * (`paym_subm_paym_subm_inte_paym_inte_paym-9812b09f`), and a column there
 * would ride on `db:sync-links` in every deploy; a model of our own gets an
 * ordinary migration, its own soft delete, and a unique (payment, payout) pair.
 *
 * `amount` is a `bigNumber` for the same reason as `partner_credit.amount`:
 * an integer column rounded 11.8 to 12 across seven receipts in #1613.
 */
const PaymentAllocation = model
  .define("payment_allocation", {
    id: model.id().primaryKey(),
    payment_id: model.text(),
    payment_submission_id: model.text(),
    amount: model.bigNumber(),
    note: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["payment_id", "payment_submission_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    { on: ["payment_submission_id"], where: "deleted_at IS NULL" },
  ])

export default PaymentAllocation
