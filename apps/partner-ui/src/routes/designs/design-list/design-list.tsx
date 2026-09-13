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
  PartnerDesignEngagement,
  DesignBucket,
  DesignBucketFacets,
} from "../../../hooks/api/partner-designs"
import { useDataTable } from "../../../hooks/use-data-table"
import { useQueryParams } from "../../../hooks/use-query-params"
import { useDate } from "../../../hooks/use-date"
import { getStatusBadgeColor } from "../../../lib/status-badge"
import {
  designStatusLabel,
  engagementKeyFor,
  priorityLabel,
  workStatusLabel,
} from "../../../lib/design-labels"

const columnHelper = createDataTableColumnHelper<PartnerDesign>()

const PAGE_SIZE = 20

// #6 — action-oriented work tabs. A single, visible lens over the same
// partner-scoped set (replacing the buried source + work-status filter
// dropdowns). Server filters + counts each bucket (see partner designs route).
const WORK_BUCKETS: DesignBucket[] = [
  "incoming",
  "in_progress",
  "yours",
  "completed",
  "all",
]

/** Map a next-action outcome to its label key + badge color. */
const NEXT_ACTION: Record<
  string,
  { key: string; color: "green" | "blue" | "orange" | "red" | "grey" }
> = {
  incoming: { key: "accept", color: "blue" },
  assigned: { key: "accept", color: "blue" },
  in_progress: { key: "working", color: "orange" },
  awaiting_review: { key: "complete", color: "orange" },
  finished: { key: "underReview", color: "blue" },
  completed: { key: "done", color: "green" },
  cancelled: { key: "cancelled", color: "red" },
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
  const { t } = useTranslation()
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
      {WORK_BUCKETS.map((value) => {
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
            <span className="font-medium">
              {t(`partner.designs.bucketOptions.${value}`)}
            </span>
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
  const { getFullDate, getRelativeDate } = useDate()
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
  const { designs, count = 0, facets, isPending, isError } = usePartnerDesigns(
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
        options: [
          { label: t("partner.designs.statusOptions.conceptual"), value: "Conceptual" },
          { label: t("partner.designs.statusOptions.inDevelopment"), value: "In_Development" },
          { label: t("partner.designs.statusOptions.technicalReview"), value: "Technical_Review" },
          { label: t("partner.designs.statusOptions.sampleProduction"), value: "Sample_Production" },
          { label: t("partner.designs.statusOptions.revision"), value: "Revision" },
          { label: t("partner.designs.statusOptions.approved"), value: "Approved" },
          { label: t("partner.designs.statusOptions.rejected"), value: "Rejected" },
          { label: t("partner.designs.statusOptions.onHold"), value: "On_Hold" },
          { label: t("partner.designs.statusOptions.commerceReady"), value: "Commerce_Ready" },
        ],
      },
    ],
    [t]
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: () => t("partner.designs.list.columns.name"),
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue() || "-"}</span>
        ),
      }),
      columnHelper.accessor(
        (row) => (row as any)?.partner_engagement as PartnerDesignEngagement | undefined,
        {
          id: "source",
          header: () => t("partner.designs.list.columns.source"),
          // Was "Yours"/"Assigned" keyed on is_owner alone — which called every
          // design an admin merely LINKED "Assigned", whether or not the partner
          // was ever given work on it. `partner_engagement` separates the two,
          // and an owned design that also carries a run shows both badges rather
          // than one label swallowing the other. Nothing is hidden or filtered.
          cell: ({ getValue, row }) => {
            const engagement = getValue()
            const hasRun = !!(row.original as any)?.has_partner_run
            const key = engagementKeyFor(engagement)
            const labelKey = `${key}.label`
            const hintKey = `${key}.hint`
            const badgeColor =
              engagement === "owned" ? "green" : engagement === "assigned" ? "blue" : "grey"
            return (
              <div className="flex flex-wrap items-center gap-1">
                <Tooltip content={t(hintKey)}>
                  <Badge size="2xsmall" color={badgeColor}>
                    {t(labelKey)}
                  </Badge>
                </Tooltip>
                {engagement === "owned" && hasRun && (
                  <Tooltip content={t("partner.designs.engagementOptions.assigned.hint")}>
                    <Badge size="2xsmall" color="blue">
                      {t("partner.designs.engagementOptions.assigned.label")}
                    </Badge>
                  </Tooltip>
                )}
              </div>
            )
          },
        }
      ),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "next_action",
        header: () => t("partner.designs.list.columns.nextAction"),
        cell: ({ getValue }) => {
          const action = NEXT_ACTION[String(getValue() ?? "")]
          if (!action) return "-"
          return (
            <StatusBadge color={action.color} className="text-nowrap">
              {t(`partner.designs.actionOptions.${action.key}`)}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor((row) => row?.partner_info?.partner_status, {
        id: "partner_status",
        header: () => t("partner.designs.list.columns.workStatus"),
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          return (
            <StatusBadge color={getStatusBadgeColor(val) as any} className="text-nowrap">
              {workStatusLabel(t, String(val))}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor((row) => (row as any)?.priority, {
        id: "priority",
        header: () => t("partner.designs.list.columns.priority"),
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          const color =
            val === "urgent" ? "red" :
            val === "high" ? "orange" :
            val === "medium" ? "blue" : "grey"
          return (
            <Badge size="2xsmall" color={color}>
              {priorityLabel(t, String(val))}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => (row as any)?.target_completion_date, {
        id: "target_date",
        header: () => t("partner.designs.list.columns.due"),
        cell: ({ getValue }) => {
          const val = getValue() as string | undefined | null
          if (!val) return "-"
          const target = new Date(val)
          const diffDays = Math.ceil(
            (target.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
          const color = diffDays < 0 ? "red" : diffDays <= 2 ? "orange" : "grey"
          return (
            <Badge size="2xsmall" color={color}>
              {diffDays < 0
                ? t("partner.designs.overdue")
                : getFullDate({ date: val })}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: () => t("partner.designs.list.columns.status"),
        cell: ({ getValue }) => {
          const val = getValue()
          if (!val) return "-"
          return (
            <Badge size="2xsmall" color={getStatusBadgeColor(val)}>
              {designStatusLabel(t, String(val))}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("updated_at", {
        header: () => t("partner.designs.list.columns.lastUpdated"),
        cell: ({ getValue }) => {
          const val = getValue() as string
          if (!val) return "-"
          const fullDate = getFullDate({ date: val, includeTime: true })
          return (
            <Tooltip content={fullDate}>
              <Text size="small" leading="compact" className="text-ui-fg-subtle cursor-default">
                {getRelativeDate(val)}
              </Text>
            </Tooltip>
          )
        },
        enableSorting: true,
      }),
    ],
    // `t` changes with the language, and the `useDate` formatters follow the
    // same locale, so depending on `t` alone keeps the memo correct without
    // churning the table on every render (the date functions are recreated
    // each render).
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
          <Heading>{t("partner.designs.heading")}</Heading>
          <Text size="small" className="text-ui-fg-error mt-2">
            {t("partner.designs.list.loadFailed")}
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
            <Heading>{t("partner.designs.heading")}</Heading>
            <span className="text-ui-fg-subtle text-xs">
              {t("partner.designs.list.subtitle")}
            </span>
          </div>
          <Link to="/designs/create">
            <Button size="small" variant="secondary">
              {t("actions.create")}
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
            { key: "updated_at", label: t("partner.designs.list.columns.lastUpdated") },
            { key: "name", label: t("partner.designs.list.columns.name") },
            { key: "created_at", label: t("fields.createdAt") },
          ]}
          search
          queryObject={raw}
          noRecords={{
            message: t("partner.designs.list.noRecords"),
          }}
        />
      </Container>
    </SingleColumnPage>
  )
}