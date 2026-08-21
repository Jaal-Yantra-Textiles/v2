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
import { useCallback, useMemo } from "react"
import debounce from "lodash/debounce"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useProductionRuns, type AdminProductionRun } from "../../hooks/api/production-runs"
import { usePartners } from "../../hooks/api/partners"
import { productionRunStatusColor } from "../../lib/status-colors"

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<AdminProductionRun>()

// ── URL ↔ state helpers ──────────────────────────────────────────────────

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

const parseFiltersFromParams = (sp: URLSearchParams): DataTableFilteringState => {
  const f: DataTableFilteringState = {}
  const status = sp.get("status")
  if (status) f.status = status
  const runType = sp.get("run_type")
  if (runType) f.run_type = runType
  const partnerId = sp.get("partner_id")
  if (partnerId) f.partner_id = partnerId
  return f
}

const buildParams = (
  filters: DataTableFilteringState,
  pagination: DataTablePaginationState,
  search: string
): URLSearchParams => {
  const p = new URLSearchParams()
  if (filters.status) p.set("status", filters.status as string)
  if (filters.run_type) p.set("run_type", filters.run_type as string)
  if (filters.partner_id) p.set("partner_id", filters.partner_id as string)
  if (search) p.set("q", search)
  if (pagination.pageIndex > 0) p.set("page", String(pagination.pageIndex + 1))
  if (pagination.pageSize !== PAGE_SIZE) p.set("limit", String(pagination.pageSize))
  return p
}

// ── Page component ────────────────────────────────────────────────────────

const ProductionRunsListPage = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Search + filters + pagination from URL ─────────────────────────────
  const search = searchParams.get("q") ?? ""
  const filtering = parseFiltersFromParams(searchParams)
  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, parseInt(searchParams.get("page") || "1", 10) - 1),
    pageSize: parseInt(searchParams.get("limit") || String(PAGE_SIZE), 10),
  }

  const offset = pagination.pageIndex * pagination.pageSize

  // ── Data ───────────────────────────────────────────────────────────────
  const { production_runs, count, isLoading, isError, error } = useProductionRuns({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    status: filtering.status as string | undefined,
    run_type: filtering.run_type as string | undefined,
    partner_id: filtering.partner_id as string | undefined,
  })

  // ── Partner filter options ─────────────────────────────────────────────
  const { partners = [] } = usePartners({ limit: 100, offset: 0 })
  const partnerOptions = useMemo(
    () =>
      (partners || [])
        .filter((p) => p?.id && p?.name)
        .map((p) => ({ label: p.name, value: p.id })),
    [partners]
  )

  // ── Columns ─────────────────────────────────────────────────────────────
  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "ID",
        cell: ({ getValue }) => (
          <span className="font-mono text-ui-fg-subtle">{getValue()}</span>
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
          return t ? <span className="capitalize">{t}</span> : "—"
        },
      }),
      columnHelper.accessor("quantity", {
        header: "Qty",
        cell: ({ getValue }) => getValue() ?? "—",
      }),
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ getValue }) => {
          const id = getValue()
          if (!id) return "—"
          const partner = (partners || []).find((p) => p.id === id)
          return partner?.name ?? id
        },
      }),
      columnHelper.accessor("design_id", {
        header: "Design",
        cell: ({ getValue }) => {
          const id = getValue()
          return id ? <span className="font-mono text-ui-fg-subtle">{id}</span> : "—"
        },
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => {
          const v = getValue()
          return v ? new Date(v as any).toLocaleDateString() : "—"
        },
      }),
    ],
    [partners]
  )

  // ── Filters ──────────────────────────────────────────────────────────────
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
    [partnerOptions]
  )

  // ── URL sync callbacks ───────────────────────────────────────────────────
  const handlePaginationChange = useCallback(
    (np: DataTablePaginationState) => {
      setSearchParams(buildParams(filtering, np, search), { replace: true })
    },
    [filtering, search, setSearchParams]
  )

  const handleFilterChange = useCallback(
    debounce((nf: DataTableFilteringState) => {
      setSearchParams(buildParams(nf, { pageIndex: 0, pageSize: pagination.pageSize }, search), {
        replace: true,
      })
    }, 300),
    [pagination.pageSize, search, setSearchParams]
  )

  const handleSearchChange = useCallback(
    debounce((ns: string) => {
      setSearchParams(buildParams(filtering, pagination, ns), { replace: true })
    }, 300),
    [filtering, pagination, setSearchParams]
  )

  // ── Table ─────────────────────────────────────────────────────────────────
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
      onPaginationChange: handlePaginationChange,
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
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Production Runs</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Search by run ID, design name, partner, or product
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter production runs" />
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Search placeholder="Search by ID, design, partner, or product..." />
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
