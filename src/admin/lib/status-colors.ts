/**
 * Shared status color utility for production runs and related badges.
 */
export const productionRunStatusColor = (status?: string) => {
  switch (status) {
    case "draft":
      return "grey"
    case "pending_review":
      return "orange"
    case "approved":
      return "green"
    case "sent_to_partner":
      return "orange"
    case "in_progress":
      return "orange"
    case "completed":
      return "green"
    case "cancelled":
      return "red"
    default:
      return "grey"
  }
}
