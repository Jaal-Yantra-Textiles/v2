/**
 * PURE: may this approval be answered, and is the answer well-formed?
 *
 * A link is answerable ONCE. After a decision the page shows what was decided;
 * a second POST must not flip an approval to a rejection after we have already
 * asked for the balance on the strength of it.
 */
export type ApprovalDecisionInput = {
  approval:
    | {
        status: string
        expires_at?: Date | string | null
      }
    | null
    | undefined
  decision: unknown
  reason: unknown
  now: Date
}

export type ApprovalRefusal =
  | "not_found"
  | "already_decided"
  | "superseded"
  | "expired"
  | "bad_decision"
  | "reason_required"

export type ApprovalDecision =
  | { ok: true; decision: "approved" | "rejected"; reason: string | null }
  | { ok: false; refusal: ApprovalRefusal; message: string }

/** Why a link can't be answered right now, or null when it can. */
export function approvalUnusableReason(
  approval: { status: string; expires_at?: Date | string | null } | null | undefined,
  now: Date
): { refusal: ApprovalRefusal; message: string } | null {
  if (!approval) {
    return { refusal: "not_found", message: "This approval link is not valid." }
  }
  if (approval.status === "approved" || approval.status === "rejected") {
    return {
      refusal: "already_decided",
      message: `This request was already ${approval.status}.`,
    }
  }
  if (approval.status === "superseded") {
    return {
      refusal: "superseded",
      message: "A newer approval request was sent for this order. Please use the latest email.",
    }
  }
  if (approval.expires_at && new Date(approval.expires_at).getTime() <= now.getTime()) {
    return {
      refusal: "expired",
      message: "This approval link has expired. Reply to our email and we'll send a new one.",
    }
  }
  return null
}

export function decideApproval(input: ApprovalDecisionInput): ApprovalDecision {
  const unusable = approvalUnusableReason(input.approval, input.now)
  if (unusable) {
    return { ok: false, ...unusable }
  }

  if (input.decision !== "approved" && input.decision !== "rejected") {
    return {
      ok: false,
      refusal: "bad_decision",
      message: "decision must be 'approved' or 'rejected'.",
    }
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : ""
  if (input.decision === "rejected" && !reason) {
    return {
      ok: false,
      refusal: "reason_required",
      message: "Please tell us what isn't right, so we can fix it.",
    }
  }

  return { ok: true, decision: input.decision, reason: reason || null }
}
