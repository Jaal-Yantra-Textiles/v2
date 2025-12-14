import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useMemo } from "react"
import { useParams } from "react-router-dom"

import { ActivitiesSection } from "../../../components/common/activities-section"
import { SectionRow } from "../../../components/common/section"
import { SingleColumnPage, TwoColumnPage } from "../../../components/layout/pages"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  usePartnerInventoryOrder,
} from "../../../hooks/api/partner-inventory-orders"
import { InventoryOrderActionsSection } from "./components/inventory-order-actions-section"

export const InventoryOrderDetail = () => {
  const { id } = useParams()

  if (!id) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={false}>
        <Container className="p-6">
          <Heading>Inventory Order</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Missing order id
          </Text>
        </Container>
      </SingleColumnPage>
    )
  }

  const { inventoryOrder, isPending, isError, error } = usePartnerInventoryOrder(id)

  const orderLines = (inventoryOrder?.order_lines || []) as Array<Record<string, any>>

  if (isError) {
    throw error
  }

  const activities = useMemo(() => {
    const partnerInfo = inventoryOrder?.partner_info || {}

    const items = [
      {
        id: "assigned",
        title: "assigned",
        status: partnerInfo?.partner_status || "-",
        timestamp: partnerInfo?.partner_assigned_at,
      },
      {
        id: "started",
        title: "started",
        status: partnerInfo?.partner_started_at ? "Completed" : "Pending",
        timestamp: partnerInfo?.partner_started_at,
      },
      {
        id: "completed",
        title: "completed",
        status: partnerInfo?.partner_completed_at ? "Completed" : "Pending",
        timestamp: partnerInfo?.partner_completed_at,
      },
    ]

    return items
  }, [inventoryOrder])

  return (
    <TwoColumnPage
      widgets={{ before: [], after: [], sideBefore: [], sideAfter: [] }}
      hasOutlet
    >
      <TwoColumnPage.Main>
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>Inventory Order</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {inventoryOrder?.id}
              </Text>
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    Status
                  </Text>
                  {inventoryOrder?.status ? (
                    <Badge
                      size="2xsmall"
                      color={getStatusBadgeColor(inventoryOrder.status)}
                    >
                      {String(inventoryOrder.status)}
                    </Badge>
                  ) : (
                    <Text size="small" className="text-ui-fg-subtle">
                      -
                    </Text>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    Partner status
                  </Text>
                  {inventoryOrder?.partner_info?.partner_status ? (
                    <Badge
                      size="2xsmall"
                      color={getStatusBadgeColor(inventoryOrder.partner_info.partner_status)}
                    >
                      {String(inventoryOrder.partner_info.partner_status)}
                    </Badge>
                  ) : (
                    <Text size="small" className="text-ui-fg-subtle">
                      -
                    </Text>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">General</Heading>
          </div>
          <SectionRow title="Order ID" value={inventoryOrder?.id || "-"} />
          <SectionRow
            title="Status"
            value={
              inventoryOrder?.status ? (
                <Badge size="2xsmall" color={getStatusBadgeColor(inventoryOrder.status)}>
                  {String(inventoryOrder.status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
          <SectionRow
            title="Partner status"
            value={
              inventoryOrder?.partner_info?.partner_status ? (
                <Badge
                  size="2xsmall"
                  color={getStatusBadgeColor(inventoryOrder.partner_info.partner_status)}
                >
                  {String(inventoryOrder.partner_info.partner_status)}
                </Badge>
              ) : (
                "-"
              )
            }
          />
        </Container>

        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Lines</Heading>
          </div>
          <div className="px-6 py-4">
            <div className="flex flex-col gap-y-3">
              {!orderLines.length ? (
                <Text size="small" className="text-ui-fg-subtle">
                  No lines
                </Text>
              ) : (
                orderLines.map((line) => {
                  const title =
                    line?.inventory_items?.[0]?.title ||
                    line?.inventory_items?.[0]?.name ||
                    line?.inventory_item_id ||
                    line?.id

                  return (
                    <div
                      key={String(line.id)}
                      className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-[1fr_220px]"
                    >
                      <div className="min-w-0">
                        <Text size="small" weight="plus" className="truncate">
                          {String(title)}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Line: {String(line.id)}
                        </Text>
                      </div>
                      <div>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Quantity
                        </Text>
                        <Text size="small">{String(line?.quantity ?? 0)}</Text>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </Container>
      </TwoColumnPage.Main>

      <TwoColumnPage.Sidebar>
        {inventoryOrder && (
          <InventoryOrderActionsSection
            inventoryOrder={inventoryOrder}
            isPending={isPending}
          />
        )}
        <ActivitiesSection title="Activities" items={activities} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  )
}
