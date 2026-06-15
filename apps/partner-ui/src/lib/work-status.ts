// The §5 work-progress vocabulary for unified work-orders (#342). The status
// lives on the typed `unified_order_status.partner_status` column (PR-F). PR-H
// retired the `metadata.partner_status` copy entirely, so the column is the sole
// read surface. Shared between the orders list "Work status" column and the
// unified order-detail work-status badge.

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
