import {
  Container,
  DataTable,
  Heading,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  useDataTable,
} from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useQuotes, type AdminQuote } from "../../hooks/api/quotes"

const PAGE_SIZE = 20

const columnHelper = createDataTableColumnHelper<AdminQuote>()

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      }).format(amount)

const QuotesPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const { quotes, count, isLoading } = useQuotes()

  const columns = useMemo(
    () => [
      columnHelper.accessor("recipient_company", {
        header: "Buyer",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Text size="small" leading="compact">
              {row.original.recipient_company ||
                row.original.recipient_name ||
                "—"}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {row.original.email_sent_to || ""}
            </Text>
          </div>
        ),
      }),
      columnHelper.accessor("quoted_landed_total", {
        header: "Landed total",
        cell: ({ row }) =>
          money(row.original.quoted_landed_total, row.original.currency_code),
      }),
      columnHelper.accessor("destination_country_code", {
        header: "Destination",
        cell: ({ getValue }) => String(getValue() || "—").toUpperCase(),
      }),
      columnHelper.accessor("view_count", {
        header: "Viewed",
        cell: ({ getValue }) => {
          const n = Number(getValue() || 0)
          // "Not yet" rather than 0 — a zero reads as a metric, and the fact
          // that matters here is whether the buyer has opened it at all.
          return n === 0 ? "Not yet" : `${n}×`
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = String(getValue() || "active")
          return (
            <StatusBadge color={status === "active" ? "green" : "red"}>
              {status === "active" ? "Active" : "Revoked"}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor("expires_at", {
        header: "Expires",
        cell: ({ getValue }) => {
          const raw = getValue() as string | null
          if (!raw) return "—"
          return new Date(raw).toLocaleDateString()
        },
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: (quotes ?? []) as AdminQuote[],
    getRowId: (row) => row.id,
    rowCount: count ?? 0,
    isLoading,
    pagination: { state: pagination, onPaginationChange: setPagination },
    onRowClick: (_e, row) => navigate(`/quotes/${row.id}`),
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
          <div>
            <Heading>Quotes</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              B2B quotes minted for partners. A quote's buyer link is shown once
              at mint and cannot be recovered — re-mint to issue a new one.
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

// Sidebar entry. Without a config the page compiles, routes, and is reachable
// only by typing the URL — which is exactly how the partner-side quote list sat
// unreachable until now.
export const config = defineRouteConfig({
  label: "Quotes",
  icon: DocumentText,
})

export const handle = {
  breadcrumb: () => "Quotes",
}

export default QuotesPage
