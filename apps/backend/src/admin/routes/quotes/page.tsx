import {
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  useDataTable,
} from "@medusajs/ui"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText, Eye, XCircle } from "@medusajs/icons"
import { keepPreviousData } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { debounce } from "lodash"

import { EntityActions } from "../../components/persons/personsActions"
import { TableSkeleton } from "../../components/table/skeleton"
import { usePartners } from "../../hooks/api/partners"
import { useQuotes, type AdminQuote } from "../../hooks/api/quotes"

const PAGE_SIZE = 20

const columnHelper = createDataTableColumnHelper<AdminQuote>()
const filterHelper = createDataTableFilterHelper<AdminQuote>()

const money = (amount?: number | null, currency?: string) =>
  amount === null || amount === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: (currency || "usd").toUpperCase(),
      }).format(amount)

/**
 * A quote's lifecycle, as a badge.
 *
 * 🔑 `superseded` is deliberately NOT red. Nobody withdrew that quote — a newer
 * one for the same buyer replaced it and expired its price list (#1435).
 * Colouring it like a revocation would tell an operator the partner pulled the
 * offer, which is a different and wrong story.
 */
const StatusCell = ({ status }: { status?: string }) => {
  const value = String(status || "active")
  return (
    <StatusBadge
      color={
        value === "active" ? "green" : value === "superseded" ? "orange" : "red"
      }
    >
      {value === "active"
        ? "Active"
        : value === "superseded"
          ? "Superseded"
          : "Revoked"}
    </StatusBadge>
  )
}

const QuotesPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")
  const [sorting, setSorting] = useState<{ id: string; desc: boolean } | null>(
    null
  )

  const offset = pagination.pageIndex * pagination.pageSize
  const orderParam = sorting?.id
    ? `${sorting.id}:${sorting.desc ? "DESC" : "ASC"}`
    : undefined

  /**
   * 🔑 Every one of these reaches the SERVER now (#1441). Until that landed,
   * the route returned the whole table and reported `count = quotes.length`,
   * so this table paged client-side over everything ever minted and its filter
   * narrowed one page rather than the set.
   */
  const { quotes, count, isLoading } = useQuotes(
    {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
      ...(orderParam ? { order: orderParam } : {}),
      ...(filtering.status ? { status: String(filtering.status) } : {}),
      ...(filtering.partner_id
        ? { partner_id: String(filtering.partner_id) }
        : {}),
    },
    { placeholderData: keepPreviousData }
  )

  const { partners } = usePartners({ limit: 200 } as any)

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
        enableSorting: true,
        cell: ({ row }) =>
          money(row.original.quoted_landed_total, row.original.currency_code),
      }),
      columnHelper.accessor("destination_country_code", {
        header: "Destination",
        cell: ({ getValue }) => String(getValue() || "—").toUpperCase(),
      }),
      columnHelper.accessor("view_count", {
        header: "Viewed",
        enableSorting: true,
        cell: ({ getValue }) => {
          const n = Number(getValue() || 0)
          // "Not yet" rather than 0 — a zero reads as a metric, and the fact
          // that matters here is whether the buyer has opened it at all.
          return n === 0 ? "Not yet" : `${n}×`
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        enableSorting: true,
        cell: ({ getValue }) => <StatusCell status={getValue() as string} />,
      }),
      columnHelper.accessor("expires_at", {
        header: "Expires",
        enableSorting: true,
        cell: ({ getValue }) => {
          const raw = getValue() as string | null
          if (!raw) return "—"
          return new Date(raw).toLocaleDateString()
        },
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={{
              actions: [
                {
                  icon: <Eye />,
                  label: "View",
                  to: (quote: AdminQuote) => `/quotes/${quote.id}`,
                },
                {
                  icon: <XCircle />,
                  label: "Revoke",
                  // Revoke lives on the detail page, behind a confirm: it
                  // DELETES a live price list, and a one-click destructive
                  // action in a row menu is how that gets done by accident.
                  to: (quote: AdminQuote) => `/quotes/${quote.id}`,
                  disabled: row.original.status !== "active",
                  disabledTooltip:
                    "Only an active quote can be revoked — this one is already dead.",
                },
              ],
            }}
          />
        ),
      }),
    ],
    []
  )

  const filters = useMemo(
    () => [
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: [
          { label: "Active", value: "active" },
          { label: "Superseded", value: "superseded" },
          { label: "Revoked", value: "revoked" },
        ],
      }),
      filterHelper.accessor("partner_id" as any, {
        type: "select",
        label: "Partner",
        options: (partners ?? []).map((p: any) => ({
          label: p.name || p.handle || p.id,
          value: p.id,
        })),
      }),
    ],
    [partners]
  )

  const handleSearchChange = useCallback(
    debounce((value: string) => setSearch(value), 300),
    []
  )
  const handleFilterChange = useCallback(
    debounce((value: DataTableFilteringState) => setFiltering(value), 300),
    []
  )

  const table = useDataTable({
    columns,
    data: (quotes ?? []) as AdminQuote[],
    getRowId: (row) => row.id,
    rowCount: count ?? 0,
    isLoading,
    filters,
    onRowClick: (_e, row) => navigate(`/quotes/${row.id}`),
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
    sorting: { state: sorting, onSortingChange: setSorting },
  })

  if (isLoading && !quotes) {
    return (
      <TableSkeleton
        layout="fill"
        rowCount={10}
        search={true}
        filters={true}
        orderBy={true}
        pagination={true}
      />
    )
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col justify-between gap-y-4 px-6 py-4 md:flex-row">
          <div>
            <Heading>Quotes</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              B2B quotes minted for partners. A quote's buyer link is shown once
              at mint and cannot be recovered — re-mint to issue a new one.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search placeholder="Search buyer, company or email..." />
            <DataTable.FilterMenu tooltip="Filter quotes" />
            <Button size="small" onClick={() => navigate("/quotes/create")}>
              Mint quote
            </Button>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table
          emptyState={{
            empty: {
              heading: "No quotes yet",
              description:
                "Mint a quote on a partner's behalf to share real landed prices with a business buyer.",
            },
            // Distinct copy on purpose: "nothing exists" and "nothing matched
            // your filter" are different facts, and conflating them sends an
            // operator hunting for data that is simply filtered out.
            filtered: {
              heading: "No matching quotes",
              description: "No quote matches this search or filter.",
            },
          }}
        />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

/**
 * Sidebar entry.
 *
 * `nested: "/orders"` puts this under Orders rather than at the top level — a
 * quote is a pre-order, and it belongs beside the other order kinds instead of
 * competing with them for attention. Same mechanism `routes/design-orders`
 * uses; no folder move is required.
 */
export const config = defineRouteConfig({
  label: "Quotes",
  icon: DocumentText,
  nested: "/orders",
})

export const handle = {
  breadcrumb: () => "Quotes",
}

export default QuotesPage
