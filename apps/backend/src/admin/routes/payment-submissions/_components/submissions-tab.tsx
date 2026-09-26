import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  Button,
  CommandBar,
  Container,
  StatusBadge,
  DataTable,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  useDataTable,
  usePrompt,
  toast,
  type DataTableFilteringState,
  type DataTablePaginationState,
  type DataTableRowSelectionState,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import {
  usePaymentSubmissions,
  useReviewPaymentSubmission,
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

/**
 * The only statuses the review workflow accepts. "Approve All" skips anything
 * else in the selection rather than sending it to a route that refuses it.
 */
const REVIEWABLE_STATUSES = new Set<string>(["Pending", "Under_Review"])

const PAGE_SIZE = 20
const SEARCH_PARAM = "q"
const PAGE_PARAM = "page"

/**
 * 🔴 Medusa's OWN helper, not `@tanstack/react-table`'s. Only this one has
 * `.select()`, and without that column the table renders no checkboxes at
 * all — `rowSelection` state is wired, nothing can set it, and the bulk
 * command bar can never open.
 */
const columnHelper = createDataTableColumnHelper<PaymentSubmission>()

/**
 * A select filter's value is a scalar once picked, `[]` while it has just been
 * added and left empty. `[]` and "" mean "no filter" — never a query value.
 */
const scalarFilterValue = (value: unknown): string | null => {
  if (Array.isArray(value)) return value.length ? String(value[0]) : null
  if (value === null || value === undefined) return null
  const s = String(value)
  return s === "" ? null : s
}

export const SubmissionsTab = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  /**
   * The URL is the single source of truth for search, filters and page, so the
   * view survives the round trip into a submission's detail page and back —
   * and a refresh, and a pasted link.
   *
   * `page` is 1-based in the URL (what a human reads) and 0-based in the
   * table (what tanstack expects).
   */
  const pageFromUrl = parseInt(searchParams.get(PAGE_PARAM) || "1", 10)
  const pageIndex = Math.max(0, (Number.isNaN(pageFromUrl) ? 1 : pageFromUrl) - 1)
  const search = searchParams.get(SEARCH_PARAM) || ""

  const filtering = useMemo<DataTableFilteringState>(() => {
    const partnerId = searchParams.get("partner_id")
    const status = searchParams.get("status")
    return {
      ...(partnerId ? { partner_id: partnerId } : {}),
      ...(status ? { status } : {}),
    }
  }, [searchParams])

  const pagination: DataTablePaginationState = {
    pageIndex,
    pageSize: PAGE_SIZE,
  }

  /** Read-modify-write: never drop params owned by other concerns (`tab`). */
  const writeParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams)
    mutate(params)
    setSearchParams(params, { replace: true })
  }

  const handlePaginationChange = (state: DataTablePaginationState) => {
    writeParams((params) => {
      if (state.pageIndex > 0) params.set(PAGE_PARAM, String(state.pageIndex + 1))
      else params.delete(PAGE_PARAM)
    })
  }

  /** A new search or filter re-pages from the start; page 3 of the old result
   *  set is not page 3 of the new one. */
  const handleSearchChange = (value: string) => {
    writeParams((params) => {
      if (value) params.set(SEARCH_PARAM, value)
      else params.delete(SEARCH_PARAM)
      params.delete(PAGE_PARAM)
    })
  }

  const handleFilteringChange = (value: DataTableFilteringState) => {
    writeParams((params) => {
      const partnerId = scalarFilterValue(value["partner_id"])
      const status = scalarFilterValue(value["status"])
      if (partnerId) params.set("partner_id", partnerId)
      else params.delete("partner_id")
      if (status) params.set("status", status)
      else params.delete("status")
      params.delete(PAGE_PARAM)
    })
  }

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
    const partnerFilter = filtering["partner_id"]
    const statusFilter = filtering["status"]

    /**
     * ⚠️ `zodValidator` forces `.strict()` on the list query, so an undefined
     * key must be OMITTED rather than sent as undefined — and the route rejects
     * anything it has not declared. One value each: the schema types both as a
     * scalar, and sending an array would 400 rather than widen the search.
     */
    return {
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
      ...(search ? { q: search } : {}),
      ...(partnerFilter ? { partner_id: String(partnerFilter) } : {}),
      ...(statusFilter ? { status: String(statusFilter) } : {}),
    }
  }, [pageIndex, search, filtering])

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

  const [rowSelection, setRowSelection] = useState<DataTableRowSelectionState>({})
  const prompt = usePrompt()
  const { mutateAsync: reviewSubmission } = useReviewPaymentSubmission()

  const selectedSubmissions = useMemo(
    () => (payment_submissions ?? []).filter((s) => !!rowSelection[s.id]),
    [payment_submissions, rowSelection]
  )

  const reviewableSelected = useMemo(
    () => selectedSubmissions.filter((s) => REVIEWABLE_STATUSES.has(s.status)),
    [selectedSubmissions]
  )

  const skippedCount = selectedSubmissions.length - reviewableSelected.length

  /**
   * Bulk review. Approve stops at `Approved` — the money is moved by settling
   * the reconciliation, not here — and the payment method is resolved
   * server-side (the partner's default, or their only one). A partner with
   * several methods and no default is refused, and lands in the failure list
   * rather than being paid to an arbitrary account.
   */
  const approveSelected = async () => {
    if (!reviewableSelected.length) {
      toast.info(
        "Nothing to approve — only Pending / Under Review submissions can be approved"
      )
      return
    }

    const n = reviewableSelected.length
    const confirmed = await prompt({
      title: `Approve ${n} submission${n === 1 ? "" : "s"}?`,
      description:
        `Each payout goes to the partner's default payment method (or their only one).` +
        (skippedCount
          ? ` ${skippedCount} selected submission${skippedCount === 1 ? "" : "s"} not up for review will be skipped.`
          : ""),
      variant: "confirmation",
      confirmText: "Approve",
      cancelText: "Cancel",
    })
    if (!confirmed) return

    let approved = 0
    const failed: string[] = []
    for (const submission of reviewableSelected) {
      try {
        await reviewSubmission({ id: submission.id, action: "approve" })
        approved++
      } catch (e: any) {
        failed.push(`${submission.id.slice(0, 8)}: ${e?.message || "failed"}`)
      }
    }

    if (failed.length) {
      toast.error(`${approved} approved, ${failed.length} failed`, {
        description:
          failed.slice(0, 3).join(" · ") +
          (failed.length > 3 ? ` · +${failed.length - 3} more` : ""),
      })
    } else {
      toast.success(`Approved ${approved} submission${approved === 1 ? "" : "s"}`)
    }
    setRowSelection({})
  }

  const columns = useMemo(
    () => [
      columnHelper.select(),
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
    rowSelection: {
      state: rowSelection,
      onRowSelectionChange: setRowSelection,
    },
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
      onFilteringChange: handleFilteringChange,
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

      {/*
        The bulk review queue: select the submissions that came in, approve
        them in one go. Only what is up for review is approved — the rest of
        the selection is skipped, because the review route refuses them.
      */}
      <CommandBar open={selectedSubmissions.length > 0}>
        <CommandBar.Bar>
          <CommandBar.Value>
            {selectedSubmissions.length} selected
          </CommandBar.Value>
          <CommandBar.Seperator />
          <CommandBar.Command
            label="Approve All"
            shortcut="a"
            action={approveSelected}
          />
        </CommandBar.Bar>
      </CommandBar>
    </Container>
  )
}
