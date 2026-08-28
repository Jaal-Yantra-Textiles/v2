/**
 * How a payout's status colours itself.
 *
 * PURE, and shared for the same reason `describePaymentLine` is: the moment
 * each screen decides for itself, the screens disagree. `submissions-tab` had
 * this switch inline; #1622 adds a second surface (the inventory order), and a
 * copied switch is how two screens start disagreeing about what "Approved"
 * looks like.
 *
 * ⚠️ SUBMISSION statuses only. `reconciliation-tab` carries its own vocabulary
 * (Matched / Settled / Discrepant / Waived) and colours `Settled` blue where a
 * submission would be green. It is not a copy of this one and must not be
 * folded into it.
 */
export type PaymentSubmissionStatusColor =
  | "green"
  | "orange"
  | "red"
  | "grey"
  | "blue"
  | "purple"

export const paymentSubmissionStatusColor = (
  status: string | null | undefined
): PaymentSubmissionStatusColor => {
  switch (status) {
    case "Paid":
      return "green"
    case "Approved":
      return "blue"
    case "Pending":
    case "Under_Review":
      return "orange"
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

/** Statuses as a human reads them — the enum uses an underscore. */
export const paymentSubmissionStatusLabel = (
  status: string | null | undefined
): string => (status ? String(status).replace("_", " ") : "Unknown")
