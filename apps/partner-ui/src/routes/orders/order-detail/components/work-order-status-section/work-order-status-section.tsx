import {
  ArrowUpRightOnBox,
  CheckCircle,
  CurrencyDollar,
  PencilSquare,
  PhotoSolid,
  PlaySolid,
  Swatch,
  TruckFast,
} from "@medusajs/icons"
import { Container, Copy, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import type { TFunction } from "i18next"

import { ActionMenu, ActionGroup } from "../../../../../components/common/action-menu"
import { useDate } from "../../../../../hooks/use-date"
import { getStatusBadgeColor } from "../../../../../lib/status-badge"
import {
  PARTNER_STATUS_LABELS,
  getPartnerWorkStatus,
} from "../../../../../lib/work-status"
import { OrderKind } from "../../use-order-kind"
import { usePartnerDesignInventory } from "../../../../../hooks/api/partner-design-inventory"
import {
  splitThumbnails,
  summarizeBomLines,
} from "../../../../../lib/work-order-header"

type WorkOrderStatusSectionProps = {
  order: any
  kind: OrderKind
  /** Design id for the "Manage design" deep-link (design kind only). */
  designId?: string
  /** Resolved production run — drives the design "Producing" parity strip. */
  productionRun?: any
  /** Resolved inventory order — drives the header action menu (inventory kind). */
  inventoryOrder?: any
  /** Resolved design — drives the header thumbnail strip (design kind). */
  design?: any
}

// The inventory work-order lifecycle actions, gated on partner_status. Mirrors
// the (removed) sidebar actions; now lives in the header `…` menu like retail's
// order actions. Routes are relative to /orders/:id.
const buildInventoryActions = (
  inventoryOrder: any,
  // 🔴 `TFunction`, not `(k: string) => string`. i18next types `t` against its
  // KNOWN keys, so its parameter is NARROWER than `string` — and under
  // strictFunctionTypes a function taking a narrower parameter is not
  // assignable to one taking a wider one. Widening the RETURN type does not
  // help; the parameter is the contravariant half.
  t: TFunction
): ActionGroup[] => {
  // #1752 — a pending proposal locks the partner's PAYMENT claim until the
  // admin approves or rejects it. Work and goods keep moving; see the note on
  // showStart below for why the lock is money-only. The partner may still
  // re-open "Edit lines & tax" to revise the SAME proposal.
  const pending = inventoryOrder?.pending_change?.status === "pending"

  const info = inventoryOrder?.partner_info || {}
  const status = info.partner_status
  // #790 fulfilment actions gate on the order's CORE status (same sets the admin
  // uses), which the partner view exposes as `inventoryOrder.status`. The
  // endpoints enforce validity and surface a 4xx if the state is wrong.
  const coreStatus = inventoryOrder?.status
  // #1752 — a partner proposes line edits/tax only while the order is still
  // editable (Pending / Processing), the same window the admin edit form uses.
  const editable = ["Pending", "Processing"].includes(coreStatus)
  /**
   * What a pending proposal actually locks: the MONEY, and only the money.
   *
   * A proposal disputes line quantities and tax — WHAT was supplied and HOW
   * MUCH it costs. It says nothing about whether the work should proceed.
   * Submitting a payment claim against amounts still under review is the one
   * action that cannot be taken back cleanly, so that waits.
   *
   * 🔴 Start and complete deliberately do NOT wait, and the chain is why:
   * ready-for-delivery is gated on `coreStatus === "Partial"`, which only
   * happens once completion is recorded. Locking `complete` therefore locks
   * Partial, which locks ready-for-delivery, which locks the shipment — so a
   * proposal staged at Processing would stop the order ever reaching Shipped.
   *
   * That matters because `approve-inventory-order-change.ts` states approval is
   * "deliberately post-ship", and carries a guard — "a proposal must not
   * contradict goods that have already ARRIVED" — that exists ONLY for a
   * proposal still open while goods ship and are received (#2124's review fix).
   * Locking the chain makes that state unreachable and the guard dead code.
   *
   * Same shape as #2111: a freeze argued in one direction that also blocked the
   * direction nobody meant to block.
   */
  const showStart =
    (status === "assigned" || status === "incoming") && !info.partner_started_at
  const showComplete =
    (status === "in_progress" || status === "finished") &&
    !info.partner_completed_at
  const showSubmitPayment = !pending && !!info.partner_started_at
  // Ready-for-delivery requires completion recorded (Partial) — not raw
  // "Processing", where nothing has been fulfilled yet. The API enforces this.
  /**
   * 🔴 Physical movement is NOT locked by a pending proposal.
   *
   * The last two links in the chain described above. The money waits for the
   * decision; the goods do not.
   */
  const showReadyForDelivery = coreStatus === "Partial"
  const showCreateShipment =
    coreStatus === "Processing" ||
    coreStatus === "Ready for Delivery" ||
    coreStatus === "Partial" ||
    coreStatus === "Shipped"

  const actions = [
    editable && { label: t("partner.workOrders.editLinesTax"), icon: <PencilSquare />, to: "inventory/edit" },
    showStart && { label: t("partner.workOrders.start"), icon: <PlaySolid />, to: "inventory/start" },
    showComplete && { label: t("partner.workOrders.complete"), icon: <CheckCircle />, to: "inventory/complete" },
    showReadyForDelivery && { label: t("partner.workOrders.readyForDelivery"), icon: <CheckCircle />, to: "inventory/ready-for-delivery" },
    showCreateShipment && { label: t("partner.workOrders.createShipment"), icon: <TruckFast />, to: "inventory/create-shipment" },
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
  design,
}: WorkOrderStatusSectionProps) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  /**
   * #2019 — the header carries what a partner judges the job on: the pictures,
   * and how many materials it takes.
   *
   * These sit ABOVE `RunDetailsReveal` on purpose, so they are there while the
   * run is still merely offered. #2018 collapsed the spec, sizes, full BOM and
   * costing at that stage because they are noise against accept/decline —
   * five thumbnails and a material count are the opposite: they are most of
   * how you decide.
   */
  const { inventory_items: bomLines } = usePartnerDesignInventory(
    designId ?? "",
    { enabled: kind === "design" && !!designId }
  )
  const bom = summarizeBomLines(bomLines)
  const thumbs = splitThumbnails(
    (design?.media_files ?? []) as Array<{ id?: string; url: string }>,
    5
  )

  const status = getPartnerWorkStatus(order)

  // Header action menu: "Manage design" for design; the lifecycle actions for
  // inventory (moved here from the sidebar to mirror retail's `…` order menu).
  const actionGroups: ActionGroup[] =
    kind === "design"
      ? designId
        ? [
            {
              /**
               * #2019 — the moodboard and the media manager already had routes
               * under the order (`design-details/moodboard`, `.../media`) and
               * were reachable from NOWHERE on this page: the only way in was
               * to open Design details and scroll. A route with no entry point
               * is the same as no route.
               */
              actions: [
                {
                  label: t("partner.workOrders.designDetails"),
                  icon: <ArrowUpRightOnBox />,
                  to: "design-details",
                },
                {
                  label: t("partner.designs.moodboard.heading"),
                  icon: <Swatch />,
                  to: "design-details/moodboard",
                },
                {
                  label: t("partner.designs.media.heading"),
                  icon: <PhotoSolid />,
                  to: "design-details/media",
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

  const showDesignStrip =
    kind === "design" && (thumbs.shown.length > 0 || bom.materialCount > 0)

  return (
    <Container className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
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
        {showDesignStrip && (
          <div className="mt-3 flex flex-col gap-y-2">
            {thumbs.shown.length > 0 && (
              <div className="flex items-center gap-x-1.5">
                {thumbs.shown.map((m, i) => (
                  <Link
                    key={m.id || String(i)}
                    to={`design-details/media-preview`}
                    state={{ curr: i }}
                    className="shadow-borders-base size-10 overflow-hidden rounded-md bg-ui-bg-component"
                  >
                    <img
                      src={m.url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </Link>
                ))}
                {thumbs.overflow > 0 && (
                  <Link
                    to="design-details/media"
                    className="text-ui-fg-subtle hover:text-ui-fg-base shadow-borders-base flex size-10 items-center justify-center rounded-md text-xs"
                  >
                    {`+${thumbs.overflow}`}
                  </Link>
                )}
              </div>
            )}
            {bom.materialCount > 0 && (
              /**
               * 🔴 "on this design", NOT "on this run". The BOM hangs off the
               * design and carries no run reference at all — a design made
               * twice has one BOM and two runs. Writing "linked to this run"
               * here would invent a relationship at the point of display,
               * which is the worst place to invent one because it looks
               * derived.
               */
              <Text size="small" className="text-ui-fg-subtle">
                {t("partner.workOrders.bomSummary", {
                  count: bom.materialCount,
                })}
                {bom.consumedCount > 0
                  ? ` · ${t("partner.workOrders.bomConsumed", {
                      count: bom.consumedCount,
                    })}`
                  : ""}
              </Text>
            )}
          </div>
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
