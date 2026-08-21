import {
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  StatusBadge,
  Text,
  createDataTableFilterHelper,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { Link, useNavigate } from "react-router-dom"

import { useProductionRuns, type AdminProductionRun } from "../../hooks/api/production-runs"
import { usePartners } from "../../hooks/api/partners"
import { productionRunStatusColor } from "../../lib/status-colors"

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<AdminProductionRun>()

const STATUS_OPTIONS = [
  "draft",
  "pending_review",
  "approved",
  "sent_to_partner",
  "in_progress",
  "completed",
  "cancelled",
  "awaiting_reassignment",
] as const

const labelFor = (s: string) =>
  s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

const shortId = (id: string) =>
  id && id.length > 12 ? `${id.slice(0, 8)}…` : id

const ProductionRunsListPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")

  const handleFilterChange = useCallback(
    debounce((nf: DataTableFilteringState) => {
      setFiltering(nf)
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    }, 300),
    [],
  )

  const handleSearchChange = useCallback(
    debounce((q: string) => {
      setSearch(q)
      setPagination((p) => ({ ...p, pageIndex: 0 }))
    }, 300),
    [],
  )

  const offset = pagination.pageIndex * pagination.pageSize

  const statusFilter = filtering.status
    ? Array.isArray(filtering.status)
      ? (filtering.status[0] as string)
      : (filtering.status as string)
    : undefined

  const runTypeFilter = filtering.run_type
    ? Array.isArray(filtering.run_type)
      ? (filtering.run_type[0] as string)
      : (filtering.run_type as string)
    : undefined

  const partnerFilter = filtering.partner_id
    ? Array.isArray(filtering.partner_id)
      ? (filtering.partner_id[0] as string)
      : (filtering.partner_id as string)
    : undefined

  const { production_runs, count, isLoading, isError, error } = useProductionRuns({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    status: statusFilter,
    run_type: runTypeFilter,
    partner_id: partnerFilter,
    exclude_children: true,
  })

  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const partnerOptions = useMemo(
    () =>
      (partners || [])
        .filter((p) => p?.id && p?.name)
        .map((p) => ({ label: p.name, value: p.id })),
    [partners],
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "Run",
        cell: ({ getValue }) => (
          <Link
            to={`/production-runs/${getValue()}`}
            className="text-ui-fg-interactive hover:underline font-mono text-ui-fg-subtle"
            onClick={(e) => e.stopPropagation()}
          >
            {shortId(getValue() ?? "")}
          </Link>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue() ?? ""
          return (
            <StatusBadge color={productionRunStatusColor(status) as any}>
              {labelFor(status)}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor("run_type", {
        header: "Type",
        cell: ({ getValue }) => {
          const t = getValue()
          return t ? (
            <Text size="small" className="capitalize">{t}</Text>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">—</Text>
          )
        },
      }),
      columnHelper.accessor("quantity", {
        header: "Qty",
        cell: ({ row, getValue }) => {
          const qty = getValue()
          const produced = row.original?.produced_quantity
          if (qty == null) return <Text size="small" className="text-ui-fg-subtle">—</Text>
          if (produced != null) {
            return (
              <div className="flex flex-col">
                <Text size="small" weight="plus">{produced} / {qty}</Text>
                <Text size="xsmall" className="text-ui-fg-subtle">produced</Text>
              </div>
            )
          }
          return <Text size="small">{qty}</Text>
        },
      }),
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ getValue }) => {
          const id = getValue()
          if (!id) return <Text size="small" className="text-ui-fg-subtle">—</Text>
          const partner = (partners || []).find((p) => p.id === id)
          const name = partner?.name ?? id
          return (
            <Link
              to={`/partners/${id}`}
              className="text-ui-fg-interactive hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <Text size="small">{name}</Text>
            </Link>
          )
        },
      }),
      columnHelper.accessor("design_id", {
        header: "Design",
        cell: ({ row, getValue }) => {
          const id = getValue()
          if (!id) return <Text size="small" className="text-ui-fg-subtle">—</Text>
          const designName = row.original?.snapshot?.design?.name
          return (
            <Link
              to={`/designs/${id}`}
              className="text-ui-fg-interactive hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <Text size="small">{designName || shortId(id)}</Text>
            </Link>
          )
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? (
            <Text size="small" className="text-ui-fg-subtle">
              {new Date(v as any).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </Text>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">—</Text>
          )
        },
      }),
    ],
    [partners],
  )

  const filterHelper = createDataTableFilterHelper<AdminProductionRun>()
  const filters = useMemo(
    () => [
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: STATUS_OPTIONS.map((s) => ({ label: labelFor(s), value: s })),
      }),
      filterHelper.accessor("run_type", {
        type: "select",
        label: "Type",
        options: [
          { label: "Production", value: "production" },
          { label: "Sample", value: "sample" },
        ],
      }),
      filterHelper.accessor("partner_id", {
        type: "select",
        label: "Partner",
        options: partnerOptions,
      }),
    ],
    [partnerOptions],
  )

  const table = useDataTable({
    data: production_runs ?? [],
    columns,
    rowCount: count ?? 0,
    filters,
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/production-runs/${row.id}`),
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
  })

  if (isError) {
    throw error
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
          <div>
            <Heading>Production Runs</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage production runs and their lifecycle
            </Text>
          </div>
        </DataTable.Toolbar>
        <div className="flex items-center justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
          <div className="w-full max-w-[50%] flex items-center gap-x-4">
            <DataTable.FilterMenu tooltip="Filter production runs" />
          </div>
          <div className="flex shrink-0 items-center gap-x-2">
            <DataTable.Search placeholder="Search runs, designs, partners..." />
          </div>
        </div>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const handle = {
  breadcrumb: () => "Production Runs",
}

export default ProductionRunsListPage
