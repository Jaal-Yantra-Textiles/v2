import { model } from "@medusajs/framework/utils"

/**
 * A request for a customer to approve or reject the finished goods of their
 * order, answered from a no-login email link (#2463).
 *
 * Separate from `production_run.approval_*`: that is OUR review of a partner's
 * output, and approving it mints a catalogue product. The customer's verdict is
 * a different question asked of a different person, and sharing the columns
 * would let one overwrite the other.
 */
const OrderApproval = model.define("order_approval", {
  id: model.id().primaryKey(),
  order_id: model.text().index(),
  // sha256(raw token). The raw token only ever exists in the emailed link.
  token_hash: model.text().unique(),
  status: model
    .enum(["pending", "approved", "rejected", "superseded"])
    .default("pending"),
  // The photos as they were when the request was sent — [{ url, filename? }].
  // A snapshot, so what the customer approved stays on record even if the
  // run's media changes later.
  photos: model.json().nullable(),
  // Our note to the customer, shown above the photos.
  note: model.text().nullable(),
  sent_to: model.text().nullable(),
  sent_by: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  decided_at: model.dateTime().nullable(),
  // The customer's words. Required on a rejection.
  decision_reason: model.text().nullable(),
  // When approving raised the balance: the link she was sent to pay it.
  balance_pay_url: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default OrderApproval
