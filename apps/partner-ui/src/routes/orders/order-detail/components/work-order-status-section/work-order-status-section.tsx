import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Container, Copy, Heading, StatusBadge, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { useDate } from "../../../../../hooks/use-date"
import { getStatusBadgeColor } from "../../../../../lib/status-badge"
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
} from "../../../../../lib/work-status"
import { OrderKind } from "../../use-order-kind"

type WorkOrderStatusSectionProps = {
  order: any
  kind: OrderKind
  /** Design id for the "Manage design" deep-link (design kind only). */
  designId?: string
}

/**
 * Header card for a unified work-order (#342): the order identity + the
 * partner work-status badge (read off `unified_order_status.partner_status`,
 * `metadata.partner_status` fallback). Replaces the retail OrderGeneralSection
 * for design/inventory orders, which are customer-less. Design orders also get
 * a deep-link to the design-management surface (`/designs/:id`).
 */
export const WorkOrderStatusSection = ({
  order,
  kind,
  designId,
}: WorkOrderStatusSectionProps) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  const status = getPartnerWorkStatus(order)

  return (
    <Container className="flex items-center justify-between px-6 py-4">
      <div>
        <div className="flex items-center gap-x-1">
          <Heading>#{order.display_id}</Heading>
          <Copy content={`#${order.display_id}`} className="text-ui-fg-muted" />
        </div>
        <Text size="small" className="text-ui-fg-subtle">
          {kind === "design"
            ? t("partner.workOrders.designOrder")
            : t("partner.workOrders.inventoryOrder")}
          {" · "}
          {getFullDate({ date: order.created_at, includeTime: true })}
        </Text>
      </div>
      <div className="flex items-center gap-x-3">
        {status ? (
          <StatusBadge color={getStatusBadgeColor(status)} className="text-nowrap">
            {PARTNER_STATUS_LABELS[status] ?? status}
          </StatusBadge>
        ) : (
          <Text size="small" className="text-ui-fg-muted">
            —
          </Text>
        )}
        {kind === "design" && designId && (
          <Link
            to={`/designs/${designId}`}
            className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover flex items-center gap-x-1 text-sm"
          >
            {t("partner.workOrders.manageDesign")}
            <ArrowUpRightOnBox />
          </Link>
        )}
      </div>
    </Container>
  )
}
