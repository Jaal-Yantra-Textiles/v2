import { Badge, createDataTableColumnHelper } from "@medusajs/ui"
import { Container, Heading } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import { usePartnerDesigns, PartnerDesign } from "../../../hooks/api/partner-designs"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"
import { getStatusBadgeColor } from "../../../lib/status-badge"

const columnHelper = createDataTableColumnHelper<PartnerDesign>()

const PAGE_SIZE = 20

const PARTNER_STATUS_OPTIONS = [
  { label: "Incoming", value: "incoming" },
  { label: "Assigned", value: "assigned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Finished", value: "finished" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
]

const DESIGN_STATUS_OPTIONS = [
  { label: "Conceptual", value: "Conceptual" },
  { label: "In Development", value: "In_Development" },
  { label: "Technical Review", value: "Technical_Review" },
  { label: "Sample Production", value: "Sample_Production" },
  { label: "Revision", value: "Revision" },
  { label: "Approved", value: "Approved" },
  { label: "Rejected", value: "Rejected" },
  { label: "On Hold", value: "On_Hold" },
  { label: "Commerce Ready", value: "Commerce_Ready" },
]

// Partner statuses excluded from the default view — show active work only
const EXCLUDED_PARTNER_STATUSES = ["completed", "cancelled"]
const EXCLUDED_DESIGN_STATUSES = ["Rejected"]

function relativeDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "-"
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export const DesignList = () => {
  const { t } = useTranslation()
  const raw = useQueryParams(["offset", "q", "status", "partner_status", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const q = raw.q?.trim() || ""
  const statusFilter = raw.status?.trim() || ""
  const partnerStatusFilter = raw.partner_status?.trim() || ""
  // Default sort: most recently updated first
  const order = raw.order?.trim() || "-updated_at"

  const { designs, count = 0, isPending, isError, error } = usePartnerDesigns(
    {
      limit: PAGE_SIZE,
      offset,
      status: statusFilter || undefined,
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  const filteredData = useMemo(() => {
    const text = q.toLowerCase()
    let data = (designs || []).filter((row) => {
      const id = String(row.id || "").toLowerCase()
      const name = String(row.name || "").toLowerCase()
      const status = String(row.status || "").toLowerCase()
      const partnerStatus = String(row?.partner_info?.partner_status || "").toLowerCase()

      // Partner status filter
      if (partnerStatusFilter) {
        if (partnerStatus !== partnerStatusFilter.toLowerCase()) {
          return false
        }
      } else {
        // Default: exclude completed and cancelled
        if (EXCLUDED_PARTNER_STATUSES.includes(partnerStatus)) {
          return false
        }
      }

      // Design status filter
      if (statusFilter) {
        if (status !== statusFilter.toLowerCase()) {
          return false
        }
      } else if (EXCLUDED_DESIGN_STATUSES.includes(row.status)) {
        return false
      }

      if (!text) {
        return true
      }

      return (
        id.includes(text) ||
        name.includes(text) ||
        status.includes(text) ||
        partnerStatus.includes(text)
      )
    })

    // Sort
    const sortKey = order.startsWith("-") ? order.slice(1) : order
    const desc = order.startsWith("-")

    data = [...data].sort((a, b) => {
      const av = (a as any)?.[sortKey]
      const bv = (b as any)?.[sortKey]

      if (av == null && bv == null) return 0
      if (av == null) return desc ? 1 : -1
      if (bv == null) return desc ? -1 : 1

      const aStr = String(av)
      const bStr = String(bv)
      const cmp = aStr.localeCompare(bStr)
      return desc ? -cmp : cmp
    })

    return data
  }, [designs, order, partnerStatusFilter, q, statusFilter])

  const filters = useMemo<Filter[]>(
    () => [
      {
        type: "select",
        key: "partner_status",
        label: "Work Status",
        options: PARTNER_STATUS_OPTIONS,
      },
      {
        type: "select",
        key: "status",
        label: t("fields.status"),
        options: DESIGN_STATUS_OPTIONS,
      },
    ],
    [t]
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: () => "Name",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "partner_status",
        header: () => "Work Status",
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          return (
            <Badge size="2xsmall" color={getStatusBadgeColor(val)}>
              {String(val).replace(/_/g, " ")}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => (row as any)?.priority, {
        id: "priority",
        header: () => "Priority",
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          const color =
            val === "urgent" ? "red" :
            val === "high" ? "orange" :
            val === "medium" ? "blue" : "grey"
          return (
            <Badge size="2xsmall" color={color}>
              {String(val)}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: () => "Design Status",
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          return (
            <Badge size="2xsmall" color={getStatusBadgeColor(val)}>
              {String(val).replace(/_/g, " ")}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("updated_at", {
        header: () => "Last Updated",
        cell: ({ getValue }) => relativeDate(getValue() as string),
        enableSorting: true,
      }),
    ],
    [t]
  )

  const { table } = useDataTable({
    data: filteredData,
    columns,
    enablePagination: true,
    count,
    pageSize: PAGE_SIZE,
  })

  if (isError) {
    throw error
  }

  return (
    <SingleColumnPage
      widgets={{
        before: [],
        after: [],
      }}
      hasOutlet={true}
    >
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading>Designs</Heading>
            {!partnerStatusFilter && (
              <span className="text-ui-fg-subtle text-xs">
                Showing active designs. Use filters to see completed or cancelled.
              </span>
            )}
          </div>
        </div>
        <_DataTable
          columns={columns}
          table={table}
          pagination
          navigateTo={(row) => `/designs/${row.original.id}`}
          count={count}
          isLoading={isPending}
          pageSize={PAGE_SIZE}
          filters={filters}
          orderBy={[
            { key: "updated_at", label: "Last Updated" },
            { key: "name", label: "Name" },
            { key: "created_at", label: t("fields.createdAt") },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: "No active designs. Use filters to see completed or cancelled designs.",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
