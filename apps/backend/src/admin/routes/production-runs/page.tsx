import {
  Badge,
  CommandBar,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  DataTableRowSelectionState,
  Heading,
  StatusBadge,
  Text,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  useDataTable,
} from "@medusajs/ui"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { Link, useNavigate } from "react-router-dom"

import { useProductionRuns, type AdminProductionRun } from "../../hooks/api/production-runs"
import { usePartners } from "../../hooks/api/partners"
import { productionRunStatusColor } from "../../lib/status-colors"
import { RunOutputReviewPanel } from "../../components/production-runs/run-output-review-panel"

const PAGE_SIZE = 20

/**
 * 🔴 Medusa's OWN helper, not `@tanstack/react-table`'s.
 *
 * Only this one has `.select()`, and without that column the table renders no
 * checkboxes at all — `rowSelection` state is wired, nothing can set it, and
 * the bulk command bar can never open. Configuring the state is not the same as
 * offering the control; the screen is the only place that difference shows.
 */
const columnHelper = createDataTableColumnHelper<AdminProductionRun>()

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
  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})
  /** Which review is open, if any (#1805). */
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null)

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

  const reviewFilter = filtering.approval_decision
    ? Array.isArray(filtering.approval_decision)
      ? (filtering.approval_decision[0] as string)
      : (filtering.approval_decision as string)
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
    approval_decision: reviewFilter,
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

  const selectedRunIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection]
  )

  const columns = useMemo(
    () => [
      columnHelper.select(),
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
      /**
       * #1805 — the output review, as its own column.
       *
       * It is deliberately NOT folded into Status: a rejected run is still
       * `completed`, because the work was done and the partner is still owed
       * for it. Two facts, two columns — and "—" on a completed run is the
       * queue's whole content: nobody has looked at it yet.
       */
      columnHelper.accessor("approval_decision", {
        header: "Review",
        cell: ({ row, getValue }) => {
          const decided = getValue() as string | null | undefined
          if (!decided) {
            return row.original?.status === "completed" ? (
              <Text size="small" className="text-ui-fg-subtle">
                Awaiting review
              </Text>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">—</Text>
            )
          }
          return (
            <Badge size="2xsmall" color={decided === "approved" ? "green" : "orange"}>
              {labelFor(decided)}
            </Badge>
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
      /*
        #1805 — "Awaiting review" + Status: Completed IS the review queue.
        `none` rather than an empty value: absent means "any", and the queue
        needs to ask for the runs nobody has decided about.
      */
      filterHelper.accessor("approval_decision", {
        type: "select",
        label: "Review",
        options: [
          { label: "Awaiting review", value: "none" },
          { label: "Approved", value: "approved" },
          { label: "Rejected", value: "rejected" },
        ],
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
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
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

      {/*
        #1805 — the output review, in bulk. Approve creates the catalogue
        product (once per DESIGN, however many of its runs are selected);
        reject creates nothing and records why.
      */}
      <CommandBar open={selectedRunIds.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedRunIds.length} selected</CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            label="Approve"
            shortcut="a"
            action={() => setDecision("approve")}
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            label="Reject"
            shortcut="r"
            action={() => setDecision("reject")}
          />
        </CommandBar.Bar>
      </CommandBar>

      <RunOutputReviewPanel
        decision={decision}
        runIds={selectedRunIds}
        onClose={() => setDecision(null)}
        /*
         * Clear the selection once a decision has landed. Leaving it would
         * offer the same runs for a second decision they can no longer take,
         * and the second attempt would come back as a list of "Already
         * approved" skips — technically correct, and unreadable as feedback.
         */
        onApplied={() => setRowSelection({})}
      />
    </Container>
  )
}

export const handle = {
  breadcrumb: () => "Production Runs",
}

export default ProductionRunsListPage
