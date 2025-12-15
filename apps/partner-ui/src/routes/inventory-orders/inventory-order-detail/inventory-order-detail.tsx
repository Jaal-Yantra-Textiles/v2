import {
  Badge,
  Container,
  DataTable as UiDataTable,
  Heading,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
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

type OrderLineRow = {
  id: string
  title: string
  requested: number
  fulfilled: number
  remaining: number
}

const columnHelper = createDataTableColumnHelper<OrderLineRow>()

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

  const fmt = (n: number) => {
    if (!Number.isFinite(n)) {
      return "0"
    }
    const s = (Math.round(n * 1000) / 1000).toFixed(3)
    return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
  }

  const lineRows = useMemo<OrderLineRow[]>(() => {
    return orderLines.map((line) => {
      const title =
        line?.inventory_items?.[0]?.title ||
        line?.inventory_items?.[0]?.name ||
        line?.inventory_item_id ||
        line?.id

      const requested = Number(line?.quantity) || 0
      const fulfilled = Array.isArray(line?.line_fulfillments)
        ? line.line_fulfillments.reduce(
            (sum: number, f: any) => sum + (Number(f?.quantity_delta) || 0),
            0
          )
        : 0
      const remaining = Math.max(0, requested - fulfilled)

      return {
        id: String(line.id),
        title: String(title),
        requested,
        fulfilled,
        remaining,
      }
    })
  }, [orderLines])

  const lineColumns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: () => "Item",
        cell: ({ row }) => {
          return (
            <div className="min-w-0">
              <Text size="small" className="truncate" title={row.original.title}>
                {row.original.title}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Line: {row.original.id}
              </Text>
            </div>
          )
        },
      }),
      columnHelper.accessor("requested", {
        header: () => "Requested",
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
      columnHelper.accessor("fulfilled", {
        header: () => "Fulfilled",
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
      columnHelper.accessor("remaining", {
        header: () => "Remaining",
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
    ],
    [fmt]
  )

  const lineTableInstance = useDataTable({
    data: lineRows,
    columns: lineColumns,
    rowCount: lineRows.length,
    getRowId: (row) => row.id,
  })

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
          <div className="px-6 py-4">
            <Heading>Inventory Order</Heading>
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
          {!orderLines.length ? (
            <div className="px-6 py-4">
              <Heading level="h2">Lines</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                No lines
              </Text>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <UiDataTable instance={lineTableInstance}>
                  <UiDataTable.Toolbar className="flex items-center justify-between px-6 py-4">
                    <div>
                      <Heading level="h2">Lines</Heading>
                      <Text size="small" className="text-ui-fg-subtle">
                        Requested vs fulfilled quantities
                      </Text>
                    </div>
                  </UiDataTable.Toolbar>
                  <UiDataTable.Table />
                </UiDataTable>
              </div>

              <div className="px-6 py-4 md:hidden">
                <Heading level="h2">Lines</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  Requested vs fulfilled quantities
                </Text>
                <div className="mt-3 space-y-3">
                  {orderLines.map((line) => {
                    const title =
                      line?.inventory_items?.[0]?.title ||
                      line?.inventory_items?.[0]?.name ||
                      line?.inventory_item_id ||
                      line?.id

                    const requested = Number(line?.quantity) || 0
                    const fulfilled = Array.isArray(line?.line_fulfillments)
                      ? line.line_fulfillments.reduce(
                          (sum: number, f: any) =>
                            sum + (Number(f?.quantity_delta) || 0),
                          0
                        )
                      : 0
                    const remaining = Math.max(0, requested - fulfilled)

                    return (
                      <div
                        key={String(line.id)}
                        className="rounded-lg border border-ui-border-base bg-ui-bg-base p-3"
                      >
                        <Text size="small" weight="plus" className="truncate" title={String(title)}>
                          {String(title)}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Line: {String(line.id)}
                        </Text>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div className="rounded bg-ui-bg-subtle p-2 text-center">
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              Requested
                            </Text>
                            <Text size="small">{fmt(requested)}</Text>
                          </div>
                          <div className="rounded bg-ui-bg-subtle p-2 text-center">
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              Fulfilled
                            </Text>
                            <Text size="small">{fmt(fulfilled)}</Text>
                          </div>
                          <div className="rounded bg-ui-bg-subtle p-2 text-center">
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              Remaining
                            </Text>
                            <Text size="small">{fmt(remaining)}</Text>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
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
