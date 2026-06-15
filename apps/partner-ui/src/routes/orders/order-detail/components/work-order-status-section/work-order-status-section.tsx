import {
  ArrowUpRightOnBox,
  CheckCircle,
  CurrencyDollar,
  PlaySolid,
} from "@medusajs/icons"
import { Container, Copy, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { ActionMenu, ActionGroup } from "../../../../../components/common/action-menu"
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
  /** Resolved production run — drives the design "Producing" parity strip. */
  productionRun?: any
  /** Resolved inventory order — drives the header action menu (inventory kind). */
  inventoryOrder?: any
}

// The inventory work-order lifecycle actions, gated on partner_status. Mirrors
// the (removed) sidebar actions; now lives in the header `…` menu like retail's
// order actions. Routes are relative to /orders/:id.
const buildInventoryActions = (
  inventoryOrder: any,
  t: (k: string) => string
): ActionGroup[] => {
  const info = inventoryOrder?.partner_info || {}
  const status = info.partner_status
  const showStart =
    (status === "assigned" || status === "incoming") && !info.partner_started_at
  const showComplete =
    (status === "in_progress" || status === "finished") &&
    !info.partner_completed_at
  const showSubmitPayment = !!info.partner_started_at

  const actions = [
    showStart && { label: t("partner.workOrders.start"), icon: <PlaySolid />, to: "inventory/start" },
    showComplete && { label: t("partner.workOrders.complete"), icon: <CheckCircle />, to: "inventory/complete" },
    showSubmitPayment && { label: t("partner.workOrders.submitPayment"), icon: <CurrencyDollar />, to: "inventory/submit-payment" },
  ].filter(Boolean) as ActionGroup["actions"]

  return actions.length ? [{ actions }] : []
}

/**
 * Header card for a unified work-order (#342). Mirrors the retail
 * `OrderGeneralSection` layout — identity on the left, a status-badge row +
 * `ActionMenu` on the right — so work-orders and retail orders read as one
 * product. Renders the partner work-status badge (off
 * `unified_order_status.partner_status`, `metadata.partner_status` fallback);
 * design orders add a "Producing …" parity strip and a "Manage design" action
 * to the design-management surface.
 */
export const WorkOrderStatusSection = ({
  order,
  kind,
  designId,
  productionRun,
  inventoryOrder,
}: WorkOrderStatusSectionProps) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  const status = getPartnerWorkStatus(order)

  // Header action menu: "Manage design" for design; the lifecycle actions for
  // inventory (moved here from the sidebar to mirror retail's `…` order menu).
  const actionGroups: ActionGroup[] =
    kind === "design"
      ? designId
        ? [
            {
              actions: [
                {
                  label: t("partner.workOrders.manageDesign"),
                  icon: <ArrowUpRightOnBox />,
                  to: `/designs/${designId}`,
                },
              ],
            },
          ]
        : []
      : kind === "inventory"
      ? buildInventoryActions(inventoryOrder, t)
      : []

  // Design "Producing" parity strip — mirrors the at-a-glance line summary the
  // inventory order gets from its line items.
  let producing: string | undefined
  if (kind === "design" && productionRun) {
    const parts: string[] = []
    if (productionRun.quantity != null) parts.push(`${productionRun.quantity} pcs`)
    if (productionRun.role) parts.push(String(productionRun.role))
    const taskCount = Array.isArray(productionRun.tasks) ? productionRun.tasks.length : 0
    if (taskCount > 0) parts.push(`${taskCount} task${taskCount !== 1 ? "s" : ""}`)
    if (parts.length) producing = `${t("partner.workOrders.producing")}: ${parts.join(" · ")}`
  }

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
        {producing && (
          <Text size="small" className="text-ui-fg-subtle">
            {producing}
          </Text>
        )}
      </div>
      <div className="flex items-center gap-x-2">
        {status && (
          <StatusBadge color={getStatusBadgeColor(status)} className="text-nowrap">
            {PARTNER_STATUS_LABELS[status] ?? status}
          </StatusBadge>
        )}
        {actionGroups.length > 0 && <ActionMenu groups={actionGroups} />}
      </div>
    </Container>
  )
}
