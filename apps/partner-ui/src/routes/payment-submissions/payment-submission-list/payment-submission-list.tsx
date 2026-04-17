import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  createDataTableColumnHelper,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { Link } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  usePartnerPaymentSubmissions,
  type PaymentSubmission,
} from "../../../hooks/api/partner-payment-submissions"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"

const columnHelper = createDataTableColumnHelper<PaymentSubmission>()

const PAGE_SIZE = 20

const statusColor = (
  status: string
): "green" | "orange" | "red" | "grey" | "blue" | "purple" => {
  switch (status) {
    case "Paid":
      return "green"
    case "Approved":
      return "blue"
    case "Pending":
    case "Under_Review":
      return "orange"
    case "Rejected":
      return "red"
    default:
      return "grey"
  }
}

export const PaymentSubmissionList = () => {
  const raw = useQueryParams(["offset"])
  const offset = raw.offset ? Number(raw.offset) : 0

  const {
    payment_submissions,
    count = 0,
    isPending,
    isError,
    error,
  } = usePartnerPaymentSubmissions(
    { limit: PAGE_SIZE, offset },
    { placeholderData: keepPreviousData }
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "Submission",
        cell: (ctx) => {
          const row = ctx.row.original
          return (
            <div className="flex flex-col">
              <span className="font-mono text-xs text-ui-fg-subtle">
                {row.id.slice(0, 12)}...
              </span>
              {row.notes && (
                <span className="text-xs text-ui-fg-muted truncate max-w-[200px]">
                  {row.notes}
                </span>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (ctx) => (
          <Badge color={statusColor(ctx.getValue())}>
            {ctx.getValue().replace("_", " ")}
          </Badge>
        ),
      }),
      columnHelper.accessor("total_amount", {
        header: "Amount",
        cell: (ctx) => {
          const row = ctx.row.original
          return `${(row.currency || "inr").toUpperCase()} ${Number(ctx.getValue()).toLocaleString()}`
        },
      }),
      columnHelper.accessor("items", {
        header: "Items",
        cell: (ctx) => {
          const items = ctx.getValue() || []
          const designCount = items.filter(
            (i) => i.source_type === "design" || (!i.source_type && i.design_id)
          ).length
          const taskCount = items.filter(
            (i) => i.source_type === "task" || (!i.source_type && i.task_id)
          ).length
          const parts: string[] = []
          if (designCount) parts.push(`${designCount} design${designCount !== 1 ? "s" : ""}`)
          if (taskCount) parts.push(`${taskCount} task${taskCount !== 1 ? "s" : ""}`)
          return parts.length ? parts.join(" · ") : items.length
        },
      }),
      columnHelper.accessor("submitted_at", {
        header: "Submitted",
        cell: (ctx) => {
          const v = ctx.getValue()
          return v ? new Date(v).toLocaleDateString() : "—"
        },
      }),
      columnHelper.accessor("reviewed_at", {
        header: "Reviewed",
        cell: (ctx) => {
          const v = ctx.getValue()
          return v ? new Date(v).toLocaleDateString() : "—"
        },
      }),
    ],
    []
  )

  const { table } = useDataTable({
    data: payment_submissions,
    columns: columns as any,
    count,
    pageSize: PAGE_SIZE,
    getRowId: (row, i) => row.id,
  })

  if (isError) {
    throw error
  }

  return (
    <SingleColumnPage
      widgets={{ before: [], after: [] }}
      hasOutlet={true}
    >
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Payment Submissions</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Submit completed designs or tasks for payment
            </Text>
          </div>
          <Button size="small" asChild>
            <Link to="create">New Submission</Link>
          </Button>
        </div>
        <_DataTable
          table={table}
          columns={columns as any}
          count={count}
          pageSize={PAGE_SIZE}
          pagination
          isLoading={isPending}
          navigateTo={(row) => `/payment-submissions/${row.original.id}`}
          noRecords={{
            title: "No payment submissions yet",
            message:
              "Submit your completed designs for payment by clicking New Submission.",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}

export const Component = PaymentSubmissionList
export const Breadcrumb = () => "Payment Submissions"
