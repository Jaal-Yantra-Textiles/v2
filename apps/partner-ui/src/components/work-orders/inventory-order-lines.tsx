import {
  Container,
  DataTable as UiDataTable,
  Heading,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

type OrderLineRow = {
  id: string
  title: string
  requested: number
  fulfilled: number
  remaining: number
}

const columnHelper = createDataTableColumnHelper<OrderLineRow>()

const fmt = (n: number) => {
  if (!Number.isFinite(n)) {
    return "0"
  }
  const s = (Math.round(n * 1000) / 1000).toFixed(3)
  return s.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1")
}

/**
 * The requested / fulfilled / remaining lines table for an inventory work-order
 * (#342). Shared between the (retired) bespoke inventory detail and the unified
 * order detail. Driven by the legacy inventory order's `order_lines`.
 */
export const InventoryOrderLines = ({
  orderLines,
}: {
  orderLines: Array<Record<string, any>>
}) => {
  const { t } = useTranslation()

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
        header: () => t("partner.inventoryOrders.detail.columns.item"),
        cell: ({ row }) => {
          return (
            <div className="min-w-0">
              <Text size="small" className="truncate" title={row.original.title}>
                {row.original.title}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t("partner.inventoryOrders.detail.linePrefix")}: {row.original.id}
              </Text>
            </div>
          )
        },
      }),
      columnHelper.accessor("requested", {
        header: () => t("partner.inventoryOrders.detail.columns.requested"),
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
      columnHelper.accessor("fulfilled", {
        header: () => t("partner.inventoryOrders.detail.columns.fulfilled"),
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
      columnHelper.accessor("remaining", {
        header: () => t("partner.inventoryOrders.detail.columns.remaining"),
        cell: ({ getValue }) => <Text size="small">{fmt(Number(getValue()))}</Text>,
      }),
    ],
    [t]
  )

  const lineTableInstance = useDataTable({
    data: lineRows,
    columns: lineColumns,
    rowCount: lineRows.length,
    getRowId: (row) => row.id,
  })

  if (!orderLines.length) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("partner.inventoryOrders.detail.noLines")}
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="hidden md:block">
        <UiDataTable instance={lineTableInstance}>
          <UiDataTable.Toolbar className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("partner.inventoryOrders.detail.linesDescription")}
              </Text>
            </div>
          </UiDataTable.Toolbar>
          <UiDataTable.Table />
        </UiDataTable>
      </div>

      <div className="px-6 py-4 md:hidden">
        <Heading level="h2">{t("partner.inventoryOrders.detail.linesHeading")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("partner.inventoryOrders.detail.linesDescription")}
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
                  (sum: number, f: any) => sum + (Number(f?.quantity_delta) || 0),
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
                  {t("partner.inventoryOrders.detail.linePrefix")}: {String(line.id)}
                </Text>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="rounded bg-ui-bg-subtle p-2 text-center">
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("partner.inventoryOrders.detail.columns.requested")}
                    </Text>
                    <Text size="small">{fmt(requested)}</Text>
                  </div>
                  <div className="rounded bg-ui-bg-subtle p-2 text-center">
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("partner.inventoryOrders.detail.columns.fulfilled")}
                    </Text>
                    <Text size="small">{fmt(fulfilled)}</Text>
                  </div>
                  <div className="rounded bg-ui-bg-subtle p-2 text-center">
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("partner.inventoryOrders.detail.columns.remaining")}
                    </Text>
                    <Text size="small">{fmt(remaining)}</Text>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Container>
  )
}
