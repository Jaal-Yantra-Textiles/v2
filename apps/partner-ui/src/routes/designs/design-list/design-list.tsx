import { Badge, Button, Container, Heading, StatusBadge, Text, Tooltip, clx, createDataTableColumnHelper } from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import { Filter } from "../../../components/table/data-table"
import { _DataTable } from "../../../components/table/data-table/data-table"
import {
  usePartnerDesigns,
  PartnerDesign,
  DesignBucket,
  DesignBucketFacets,
} from "../../../hooks/api/partner-designs"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"
import { getStatusBadgeColor } from "../../../lib/status-badge"

const columnHelper = createDataTableColumnHelper<PartnerDesign>()

const PAGE_SIZE = 20

// #6 — action-oriented work tabs. A single, visible lens over the same
// partner-scoped set (replacing the buried source + work-status filter
// dropdowns). Server filters + counts each bucket (see partner designs route).
const WORK_BUCKETS: Array<{ value: DesignBucket; label: string }> = [
  { value: "incoming", label: "Incoming" },
  { value: "in_progress", label: "In progress" },
  { value: "yours", label: "Yours" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
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

/** Derive the next action label from partner_status */
function getNextAction(partnerStatus: string | undefined | null): {
  label: string
  color: "green" | "blue" | "orange" | "red" | "grey"
} | null {
  switch (partnerStatus) {
    case "incoming":
    case "assigned":
      return { label: "Accept", color: "blue" }
    case "in_progress":
      return { label: "Working", color: "orange" }
    case "awaiting_review":
      return { label: "Complete", color: "orange" }
    case "finished":
      return { label: "Under Review", color: "blue" }
    case "completed":
      return { label: "Done", color: "green" }
    case "cancelled":
      return { label: "Cancelled", color: "red" }
    default:
      return null
  }
}

/** Format target date with urgency indicator */
function formatTargetDate(dateStr: string | undefined | null): {
  label: string
  color: "red" | "orange" | "grey"
} | null {
  if (!dateStr) return null
  const target = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const formatted = target.toLocaleDateString("en-US", { month: "short", day: "numeric" })

  if (diffDays < 0) return { label: `Overdue`, color: "red" }
  if (diffDays <= 2) return { label: formatted, color: "orange" }
  return { label: formatted, color: "grey" }
}

/**
 * #6 — the work tab bar. Each tab is an action-oriented lens (Incoming / In
 * progress / Yours / Completed / All) with a live count from the server facets,
 * so the boundary between assigned-and-waiting, active, owned, and done work is
 * visible at a glance. Clicking a tab sets `?bucket=` and resets pagination.
 * Wraps on mobile.
 */
const WorkBucketTabs = ({
  active,
  facets,
}: {
  active: DesignBucket
  facets?: DesignBucketFacets
}) => {
  const [searchParams, setSearchParams] = useSearchParams()

  const select = (bucket: DesignBucket) => {
    const next = new URLSearchParams(searchParams)
    if (bucket === "all") {
      next.delete("bucket")
    } else {
      next.set("bucket", bucket)
    }
    // A different lens invalidates the current page.
    next.delete("offset")
    setSearchParams(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-1 px-4 py-2">
      {WORK_BUCKETS.map(({ value, label }) => {
        const isActive = active === value
        const n = facets?.[value]
        return (
          <button
            key={value}
            type="button"
            onClick={() => select(value)}
            className={clx(
              "transition-fg flex items-center gap-x-1.5 rounded-md px-3 py-1.5 text-sm outline-none",
              isActive
                ? "bg-ui-bg-base shadow-elevation-card-rest text-ui-fg-base"
                : "text-ui-fg-subtle hover:bg-ui-bg-subtle-hover"
            )}
          >
            <span className="font-medium">{label}</span>
            {typeof n === "number" && (
              <Badge size="2xsmall" color={isActive ? "blue" : "grey"}>
                {n}
              </Badge>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const DesignList = () => {
  const { t } = useTranslation()
  const raw = useQueryParams(["offset", "q", "status", "bucket", "order"])
  const offset = raw.offset ? Number(raw.offset) : 0
  const q = raw.q?.trim() || ""
  const statusFilter = raw.status?.trim() || ""
  const bucket = ((raw.bucket?.trim() as DesignBucket) || "all") as DesignBucket
  // No client-side default sort — preserve the server order (designs come
  // back newest-assigned/created first). Only sort when the user picks one.
  const order = raw.order?.trim() || ""

  // Server now owns bucket + status + free-text filtering AND pagination, so a
  // partner's "incoming" work is complete across all pages (was previously
  // filtered client-side over just the current page). facets carry the
  // per-bucket counts for the tab badges.
  const { designs, count = 0, facets, isPending, isError, error } = usePartnerDesigns(
    {
      limit: PAGE_SIZE,
      offset,
      status: statusFilter || undefined,
      q: q || undefined,
      bucket,
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  // Filtering (bucket/status/q) + pagination now happen server-side. The only
  // remaining client step is an optional explicit sort of the current page —
  // applied just when the user picks an order, otherwise the server order
  // (newest-assigned/created first) is preserved.
  const sortedDesigns = useMemo(() => {
    let data = designs || []
    if (order) {
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
    }
    return data
  }, [designs, order])

  // Source + work-status are now the work tabs (WorkBucketTabs); only the
  // design-status filter remains in the filter menu.
  const filters = useMemo<Filter[]>(
    () => [
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
      columnHelper.accessor((row) => (row as any)?.owner_partner_id, {
        id: "source",
        header: () => "Source",
        cell: ({ getValue }) => (
          <Badge size="2xsmall" color={getValue() ? "green" : "grey"}>
            {getValue() ? "Yours" : "Assigned"}
          </Badge>
        ),
      }),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "next_action",
        header: () => "Next Action",
        cell: ({ getValue }) => {
          const action = getNextAction(getValue())
          if (!action) return "-"
          return (
            <StatusBadge color={action.color} className="text-nowrap">
              {action.label}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "partner_status",
        header: () => "Work Status",
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          return (
            <StatusBadge color={getStatusBadgeColor(val) as any} className="text-nowrap">
              {String(val).replace(/_/g, " ")}
            </StatusBadge>
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
      columnHelper.accessor((row) => (row as any)?.target_completion_date, {
        id: "target_date",
        header: () => "Due",
        cell: ({ getValue }) => {
          const info = formatTargetDate(getValue())
          if (!info) return "-"
          return (
            <Badge size="2xsmall" color={info.color}>
              {info.label}
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
        cell: ({ getValue }) => {
          const val = getValue() as string
          if (!val) return "-"
          const fullDate = new Date(val).toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          return (
            <Tooltip content={fullDate}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle cursor-default">
                {relativeDate(val)}
              </Text>
            </Tooltip>
          )
        },
        enableSorting: true,
      }),
    ],
    [t]
  )

  // Server-driven pagination: `data` is the current page, `count` is the
  // bucket total (across all pages).
  const { table } = useDataTable({
    data: sortedDesigns,
    columns,
    enablePagination: true,
    count,
    pageSize: PAGE_SIZE,
  })

  if (isError) {
    return (
      <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={true}>
        <Container className="p-6">
          <Heading>Designs</Heading>
          <Text size="small" className="text-ui-fg-error mt-2">
            Failed to load designs. Please try refreshing the page.
          </Text>
        </Container>
      </SingleColumnPage>
    )
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
        <div className="flex flex-col gap-y-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Heading>Designs</Heading>
            <span className="text-ui-fg-subtle text-xs">
              Pick a tab to see incoming, in-progress, your own, or completed work.
            </span>
          </div>
          <Link to="/designs/create">
            <Button size="small" variant="secondary">
              Create
            </Button>
          </Link>
        </div>
        {/* #6 — action tabs: the clear boundary between assigned-and-waiting,
            active, owned, and finished work. */}
        <WorkBucketTabs active={bucket} facets={facets} />
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
            message: "No designs in this tab. Try another tab or clear the search.",
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}
