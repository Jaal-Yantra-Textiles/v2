import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Button,
  Container,
  StatusBadge,
  DataTable,
  createDataTableFilterHelper,
  useDataTable,
  type DataTableFilteringState,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { keepPreviousData } from "@tanstack/react-query"
import {
  usePaymentSubmissions,
  type PaymentSubmission,
} from "../../../hooks/api/payment-submissions"
import {
  paymentSubmissionStatusColor,
  paymentSubmissionStatusLabel,
} from "../../../lib/payment-submission-status"
import { RefLink } from "../../../components/payments/payment-line-links"
import { usePartners } from "../../../hooks/api/partners-admin"

/** Every status the enum offers, so the filter cannot silently omit one. */
const SUBMISSION_STATUSES = [
  "Draft",
  "Pending",
  "Under_Review",
  "Approved",
  "Rejected",
  "Paid",
] as const

const columnHelper = createColumnHelper<PaymentSubmission>()


export const SubmissionsTab = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState<string>("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  /**
   * The partners a filter can offer. The list route has taken `partner_id`
   * and `status` all along and this screen never sent either, so "what has this
   * partner billed us" could only be answered by paging through everyone.
   */
  const { partners } = usePartners({ limit: 100, fields: ["id", "name"] }) as any

  const partnerOptions = useMemo(
    () =>
      ((partners || []) as any[])
        .map((p) => ({ label: p.name || p.id, value: p.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [partners]
  )

  const query = useMemo(() => {
    const partnerFilter = filtering["partner_id"] as any
    const statusFilter = filtering["status"] as any

    /**
     * ⚠️ `zodValidator` forces `.strict()` on the list query, so an undefined
     * key must be OMITTED rather than sent as undefined — and the route rejects
     * anything it has not declared. One value each: the schema types both as a
     * scalar, and sending an array would 400 rather than widen the search.
     */
    return {
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
      ...(search ? { q: search } : {}),
      ...(partnerFilter ? { partner_id: String(partnerFilter) } : {}),
      ...(statusFilter ? { status: String(statusFilter) } : {}),
    }
  }, [pagination, search, filtering])

  const {
    payment_submissions,
    count,
    isPending: isLoading,
  } = usePaymentSubmissions(query, {
    placeholderData: keepPreviousData,
  })

  const filterHelper = createDataTableFilterHelper<PaymentSubmission>()

  const filters = useMemo(
    () => [
      filterHelper.accessor("partner_id", {
        type: "select",
        label: "Partner",
        options: partnerOptions,
      }),
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: SUBMISSION_STATUSES.map((status) => ({
          label: paymentSubmissionStatusLabel(status),
          value: status,
        })),
      }),
    ],
    [partnerOptions]
  )

  /** A new filter or search re-pages from the start; page 3 of the old result
   *  set is not page 3 of the new one. */
  const resetToFirstPage = () =>
    setPagination((p) => ({ ...p, pageIndex: 0 }))

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "ID",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue().slice(0, 12)}...</span>
        ),
      }),
      /**
       * 🔴 Was `partner_id.slice(0, 12)` — twelve characters of a ULID,
       * repeated down the column, on the screen whose whole job is to say who
       * is owed what (#1622). Resolved by the list route now.
       */
      columnHelper.accessor("partner_id", {
        header: "Partner",
        cell: ({ row }) =>
          row.original.partner_id ? (
            <RefLink
              kind="partner"
              refOrId={row.original.partner || row.original.partner_id}
              className="text-ui-fg-interactive text-xs hover:underline"
            />
          ) : (
            "—"
          ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge color={paymentSubmissionStatusColor(getValue())}>
            {paymentSubmissionStatusLabel(getValue())}
          </StatusBadge>
        ),
      }),
      columnHelper.accessor("total_amount", {
        header: "Amount",
        cell: ({ getValue, row }) =>
          `${row.original.currency?.toUpperCase() || "INR"} ${Number(getValue()).toLocaleString()}`,
      }),
      // Counts LINES, not designs — an inventory-order or run line is not a
      // design, and the detail page stopped saying otherwise in #1621.
      columnHelper.accessor("items", {
        header: "Lines",
        cell: ({ getValue }) => (getValue() || []).length,
      }),
      columnHelper.accessor("submitted_at", {
        header: "Submitted",
        cell: ({ getValue }) =>
          getValue() ? new Date(getValue()!).toLocaleDateString() : "—",
      }),
      columnHelper.accessor("reviewed_at", {
        header: "Reviewed",
        cell: ({ getValue }) =>
          getValue() ? new Date(getValue()!).toLocaleDateString() : "—",
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: payment_submissions ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/payment-submissions/${row.id}`),
    rowCount: count ?? 0,
    isLoading,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: {
      state: search,
      onSearchChange: (value: string) => {
        setSearch(value)
        resetToFirstPage()
      },
    },
    filtering: {
      state: filtering,
      onFilteringChange: (value: DataTableFilteringState) => {
        setFiltering(value)
        resetToFirstPage()
      },
    },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-x-2">
            <DataTable.FilterMenu tooltip="Filter" />
            {/* The box has rendered since this screen existed and nothing ever
                sent its value; `q` is honoured by the route now. */}
            <DataTable.Search placeholder="Search by submission id..." />
          </div>
          <Button size="small" asChild>
            <Link to="create">New Submission</Link>
          </Button>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
