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
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { TableSkeleton } from "../../../components/table/skeleton"
import { AdminBriefListRow, useQuoteBriefs } from "../../../hooks/api/quote-briefs"

/**
 * Quote briefs (#2608): the step BEFORE a priced quote. Several partners per
 * job, estimates where rates exist, the buyer's answers and our updates on one
 * link. Listed like Quotes: a DataTable, filters and paging on the server.
 */
export const BRIEF_STATUS: Record<string, { label: string; color: "grey" | "blue" | "orange" | "green" | "purple" | "red" }> = {
  draft: { label: "Draft (no link)", color: "grey" },
  open: { label: "Link sent", color: "blue" },
  submitted: { label: "Buyer sent", color: "orange" },
  sampling: { label: "Sampling", color: "purple" },
  quoted: { label: "Quoted", color: "green" },
  closed: { label: "Closed", color: "red" },
}

const PAGE_SIZE = 20
const columnHelper = createDataTableColumnHelper<AdminBriefListRow>()
const filterHelper = createDataTableFilterHelper<AdminBriefListRow>()

const QuoteBriefsPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const { data, isLoading } = useQuoteBriefs({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    ...(filtering.status ? { status: String(filtering.status) } : {}),
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor("title", { header: "Brief" }),
      columnHelper.accessor("recipient_name", {
        header: "Buyer",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <Text size="small" leading="compact">
              {row.original.recipient_name || "—"}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {row.original.buyer_email || ""}
            </Text>
          </div>
        ),
      }),
      columnHelper.accessor("destination_country_code", {
        header: "Ships to",
        cell: ({ getValue }) => String(getValue() || "—").toUpperCase(),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const s = BRIEF_STATUS[getValue()]
          return <StatusBadge color={s?.color ?? "grey"}>{s?.label ?? getValue()}</StatusBadge>
        },
      }),
      columnHelper.accessor("submitted_at", {
        header: "Buyer sent",
        cell: ({ getValue }) => (getValue() ? new Date(getValue() as string).toLocaleDateString() : "Not yet"),
      }),
      columnHelper.accessor("view_count", {
        header: "Viewed",
        cell: ({ getValue }) => {
          const n = Number(getValue() || 0)
          return n === 0 ? "Not yet" : `${n}×`
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
    ],
    []
  )

  const filters = useMemo(
    () => [
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: Object.entries(BRIEF_STATUS).map(([value, s]) => ({ value, label: s.label })),
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: data?.briefs ?? [],
    getRowId: (row) => row.id,
    rowCount: data?.count ?? 0,
    isLoading,
    filters,
    onRowClick: (_e, row) => navigate(`/quotes/briefs/${row.id}`),
    pagination: { state: pagination, onPaginationChange: setPagination },
    filtering: { state: filtering, onFilteringChange: setFiltering },
  })

  if (isLoading && !data) {
    return <TableSkeleton layout="fill" rowCount={10} filters={true} pagination={true} />
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col justify-between gap-y-4 px-6 py-4 md:flex-row">
          <div>
            <Heading>Briefs</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Before a quote: options, the partners per step, estimates, and what the buyer tells us.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.FilterMenu tooltip="Filter briefs" />
            <Button size="small" onClick={() => navigate("/quotes/briefs/create")}>
              New brief
            </Button>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table
          emptyState={{
            empty: { heading: "No briefs yet", description: "Start one when a buyer's job needs several workshops or rates we don't have yet." },
            filtered: { heading: "No matching briefs", description: "No brief has this status." },
          }}
        />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const handle = { breadcrumb: () => "Briefs" }

export default QuoteBriefsPage
