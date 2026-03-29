export type StatusBadgeColor = "green" | "orange" | "red" | "grey" | "blue"

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
