// Admin-side mirror of the partner-ui work-status helpers
// (apps/partner-ui/src/lib/work-status.ts + status-badge.ts) so the admin order
// UI renders the SAME work-status badge the partner portal does (#403/#342).
//
// The status lives on the typed `unified_order_status.partner_status` sidecar
// column (PR-F); the admin order detail/list routes attach it (slices 1+2).
// Kept self-contained in the admin app — the backend and partner-ui can't share
// a module across app boundaries — but the label + color maps are copied
// verbatim from partner-ui to keep the two surfaces in lockstep.

export type StatusBadgeColor = "green" | "orange" | "red" | "grey" | "blue"

export const PARTNER_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "In Progress",
  partial: "Partial",
  finished: "Finished",
  completed: "Completed",
  declined: "Declined",
}

/** Resolve the partner work-status off the typed sidecar column. */
export const getPartnerWorkStatus = (order: any): string | undefined =>
  order?.unified_order_status?.partner_status as string | undefined

export const getStatusBadgeColor = (
  status?: string | null
): StatusBadgeColor => {
  const s = String(status || "")
    .trim()
    .toLowerCase()

  if (!s) {
    return "grey"
  }

  switch (s) {
    case "complete":
    case "completed":
    case "finish":
    case "finished":
    case "fulfilled":
    case "paid":
    case "active":
    case "published":
      return "green"

    case "in_progress":
    case "in progress":
    case "started":
    case "processing":
    case "proposed":
      return "orange"

    case "awaiting_review":
    case "awaiting review":
    case "technical_review":
    case "under_review":
    case "sent_to_partner":
      return "blue"

    case "approved":
    case "commerce_ready":
      return "green"

    case "failed":
    case "canceled":
    case "cancelled":
    case "rejected":
      return "red"

    case "incoming":
    case "assigned":
    case "pending":
    case "draft":
    default:
      return "grey"
  }
}
