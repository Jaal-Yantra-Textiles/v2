import { Component } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"

import { SectionRow } from "../common/section"
import { useDate } from "../../hooks/use-date"
import { getStatusBadgeColor } from "../../lib/status-badge"

type WorkOrderSummarySectionProps = {
  kind: "design" | "inventory"
  design?: any
  inventoryOrder?: any
  /** Design id for the management deep-links (design kind). */
  designId?: string
}

/**
 * #342 — consolidated Summary for a work-order, mirroring the way a retail order
 * surfaces its key context up top. Design orders borrow the important design
 * details (type, status, priority, target date, estimated cost, materials) and
 * link the partner straight to the design-management surface and its sub-routes
 * (moodboard, media). Inventory orders consolidate the order-level details
 * (delivery dates, sample, stock location) that otherwise weren't surfaced.
 */
export const WorkOrderSummarySection = ({
  kind,
  design,
  inventoryOrder,
  designId,
}: WorkOrderSummarySectionProps) => {
  const { t } = useTranslation()
  const { getFullDate } = useDate()

  if (kind === "design") {
    if (!design) {
      return null
    }
    const materials = Array.isArray(design.inventory_items)
      ? design.inventory_items.length
      : 0
    const cost = design.estimated_cost
    const costCurrency = design.cost_currency

    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("partner.workOrders.summary")}</Heading>
        </div>

        {design.design_type && (
          <SectionRow
            title={t("partner.workOrders.type")}
            value={<Badge size="2xsmall" color="blue">{String(design.design_type)}</Badge>}
          />
        )}
        {design.status && (
          <SectionRow
            title={t("partner.workOrders.designStatus")}
            value={
              <Badge size="2xsmall" color={getStatusBadgeColor(design.status)}>
                {String(design.status)}
              </Badge>
            }
          />
        )}
        {design.priority && (
          <SectionRow
            title={t("partner.workOrders.priority")}
            value={
              <Badge
                size="2xsmall"
                color={
                  design.priority === "urgent" ? "red" :
                  design.priority === "high" ? "orange" :
                  design.priority === "medium" ? "blue" : "grey"
                }
              >
                {String(design.priority)}
              </Badge>
            }
          />
        )}
        {design.target_completion_date && (
          <SectionRow
            title={t("partner.workOrders.targetDate")}
            value={getFullDate({ date: design.target_completion_date })}
          />
        )}
        {cost != null && (
          <SectionRow
            title={t("partner.workOrders.estimatedCost")}
            value={
              <Text size="small" weight="plus">
                {costCurrency ? `${String(costCurrency).toUpperCase()} ${cost}` : String(cost)}
              </Text>
            }
          />
        )}
        <SectionRow title={t("partner.workOrders.materials")} value={String(materials)} />

        {/* Design details live as a sub-route of the order (breadcrumb
            Orders › id › Design details), keeping the partner in context. The
            full design-management surface stays reachable from the Designs nav. */}
        {designId && (
          <div className="flex flex-wrap gap-2 px-6 py-4">
            <Button size="small" variant="secondary" asChild>
              <Link to="design-details">
                <Component />
                {t("partner.workOrders.designDetails")}
              </Link>
            </Button>
          </div>
        )}
      </Container>
    )
  }

  // ── Inventory ──
  if (!inventoryOrder) {
    return null
  }
  const stockLocation = Array.isArray(inventoryOrder.stock_locations)
    ? inventoryOrder.stock_locations[0]?.name
    : inventoryOrder.stock_locations?.name

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("partner.workOrders.summary")}</Heading>
      </div>
      {inventoryOrder.status && (
        <SectionRow
          title={t("partner.workOrders.orderStatus")}
          value={
            <Badge size="2xsmall" color={getStatusBadgeColor(String(inventoryOrder.status))}>
              {String(inventoryOrder.status)}
            </Badge>
          }
        />
      )}
      {inventoryOrder.is_sample != null && (
        <SectionRow
          title={t("partner.workOrders.sample")}
          value={inventoryOrder.is_sample ? t("partner.workOrders.yes") : t("partner.workOrders.no")}
        />
      )}
      {inventoryOrder.order_date && (
        <SectionRow
          title={t("partner.workOrders.orderDate")}
          value={getFullDate({ date: inventoryOrder.order_date })}
        />
      )}
      {inventoryOrder.expected_delivery_date && (
        <SectionRow
          title={t("partner.workOrders.expectedDelivery")}
          value={getFullDate({ date: inventoryOrder.expected_delivery_date })}
        />
      )}
      {stockLocation && (
        <SectionRow title={t("partner.workOrders.stockLocation")} value={String(stockLocation)} />
      )}
    </Container>
  )
}
