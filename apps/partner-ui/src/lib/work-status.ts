// The §5 work-progress vocabulary for unified work-orders (#342). The status is
// promoted to the typed `unified_order_status.partner_status` column (PR-F);
// read off the column first, with `metadata.partner_status` as a transitional
// fallback (PR-G). Shared between the orders list "Work status" column and the
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

/** Resolve the partner work-status off the column first, metadata as fallback. */
export const getPartnerWorkStatus = (order: any): string | undefined =>
  (order?.unified_order_status?.partner_status ??
    order?.metadata?.partner_status) as string | undefined
