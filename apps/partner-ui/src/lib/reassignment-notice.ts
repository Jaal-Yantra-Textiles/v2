/**
 * #1228 — what a partner is told about how a run reached them.
 *
 * A re-sent run is byte-identical to a fresh one on screen: same status, same
 * buttons, no trace of the dispatch that went unanswered. So a partner who
 * missed the first dispatch has no idea they're on a second chance, and a
 * partner picking up someone else's abandoned work has no idea it was abandoned
 * — they just see a run that appeared with a date that's already tight.
 *
 * Two distinct situations, told apart by which field the backend wrote:
 *
 *   • `reassign_retry_count > 0` — the reminder cap fired on THIS partner and
 *     the platform chose to re-nudge them rather than take the run away. They
 *     are on their last chance; the next cap parks the run for reassignment.
 *     Reset to 0 whenever a partner is (re)assigned, so a positive count always
 *     means "you, again".
 *
 *   • `previous_partner_id` set to someone else — the run was taken off another
 *     partner and re-dispatched here. Explains an inherited deadline.
 *
 * Pure so the wording is testable without mounting the card.
 */

export type ReassignmentNotice = {
  title: string
  description: string
  variant: "info" | "warning"
}

export type RunForReassignmentNotice = {
  status?: string | null
  accepted_at?: string | Date | null
  previous_partner_id?: string | null
  reassign_retry_count?: number | null
}

export const getReassignmentNotice = (
  run: RunForReassignmentNotice | null | undefined,
  myPartnerId?: string | null
): ReassignmentNotice | null => {
  if (!run) {
    return null
  }

  const status = String(run.status || "")

  // Terminal runs are history — a warning about accepting in time would be
  // noise on work that's already finished or called off.
  if (status === "completed" || status === "cancelled") {
    return null
  }

  // Defensive: reassignment nulls `partner_id`, so a partner shouldn't be able
  // to load a parked run at all. If one ever surfaces, say so plainly rather
  // than showing action buttons for work that isn't theirs.
  if (status === "awaiting_reassignment") {
    return {
      title: "No longer assigned to you",
      description:
        "This run went unanswered and has been sent back for reassignment. You don't need to do anything.",
      variant: "warning",
    }
  }

  const retries = Number(run.reassign_retry_count) || 0
  if (retries > 0 && !run.accepted_at) {
    return {
      title: "This run was sent to you again",
      description:
        "The first dispatch went unanswered, so it was re-sent rather than reassigned. Accept it to keep it — if it goes unanswered again it will be handed to another partner.",
      variant: "warning",
    }
  }

  const previous = run.previous_partner_id
  if (previous && (!myPartnerId || previous !== myPartnerId)) {
    return {
      title: "Re-assigned to you",
      description:
        "Another partner didn't accept this run, so it was handed to you. Its target date may already be close — check it before you start.",
      variant: "info",
    }
  }

  return null
}
