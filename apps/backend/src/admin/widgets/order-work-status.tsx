import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, StatusBadge } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { useQuery } from "@tanstack/react-query"
import { sdk } from "../lib/config"
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
  getStatusBadgeColor,
} from "../lib/work-status"

// #403 (orders unification → admin): surface the partner work-status on the
// admin order DETAIL as a badge, mirroring the partner-ui order-detail badge.
// The status rides on `unified_order_status.partner_status`, attached by the
// admin order detail route (slice 1). Retail orders have no sidecar → no badge.

type AdminOrder = {
  id: string
  unified_order_status?: { partner_status?: string } | null
}

const OrderWorkStatusWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  // Fast path: the detail route already attached the sidecar to the order the
  // page loaded. Fall back to a direct fetch only when the prop is absent —
  // stable across refreshes (depends on the order, not on UI state).
  const propStatus = getPartnerWorkStatus(order)

  const { data } = useQuery({
    queryFn: () =>
      sdk.client.fetch<{ order: AdminOrder }>(`/admin/orders/${order.id}`, {
        method: "GET",
        query: { fields: "id" },
      }),
    queryKey: ["order-work-status", order.id],
    enabled: !propStatus,
  })

  const status = propStatus ?? getPartnerWorkStatus(data?.order)

  // No sidecar → plain retail order → render nothing (no empty card).
  if (!status) {
    return null
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h2">Work status</Heading>
        <StatusBadge color={getStatusBadgeColor(status)} className="text-nowrap">
          {PARTNER_STATUS_LABELS[status] ?? status}
        </StatusBadge>
      </div>
      <div className="px-6 py-4">
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Production / fulfilment progress reported by the assigned partner.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.before",
})

export default OrderWorkStatusWidget
