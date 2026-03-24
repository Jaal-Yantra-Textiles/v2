/**
 * Customer Journeys Page
 * Funnel visualization + event log with cross-links
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Badge,
  DataTable,
  createDataTableColumnHelper,
  useDataTable,
  DataTablePaginationState,
  Select,
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/config"

interface JourneyEvent {
  id: string
  person_id: string | null
  visitor_id: string | null
  event_type: string
  event_name: string | null
  channel: string
  stage: string
  page_url: string | null
  utm_source: string | null
  utm_campaign: string | null
  event_data: any
  occurred_at: string
}

const STAGE_COLORS: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
  awareness: "grey",
  interest: "blue",
  consideration: "orange",
  intent: "purple",
  conversion: "green",
  retention: "green",
  advocacy: "green",
}

// --- Funnel Visualization Component ---

const FunnelChart = () => {
  const { data: funnelData } = useQuery({
    queryKey: ["ad-planning", "journeys", "funnel-viz"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/journeys/funnel")
      return res
    },
  })

  const funnel = funnelData?.funnel || []
  const summary = funnelData?.summary

  if (funnel.length === 0) {
    return (
      <Container className="px-6 py-8 text-center">
        <Text className="text-ui-fg-muted">No journey data to visualize</Text>
      </Container>
    )
  }

  const maxCount = funnel[0]?.count || 1

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Heading level="h2">Conversion Funnel</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {summary?.total_customers || 0} total visitors
              {summary?.identified_customers ? ` (${summary.identified_customers} identified, ${summary.anonymous_visitors} anonymous)` : ""}
            </Text>
          </div>
          {summary?.awareness_to_conversion_rate > 0 && (
            <Badge color="green" size="small">
              {summary.awareness_to_conversion_rate}% conversion rate
            </Badge>
          )}
        </div>
      </div>

      <div className="px-6 py-6">
        <div className="flex flex-col gap-3">
          {funnel.map((stage: any, index: number) => {
            const widthPercent = maxCount > 0 ? Math.max(8, (stage.count / maxCount) * 100) : 8
            const color = STAGE_COLORS[stage.stage] || "grey"
            const bgColors: Record<string, string> = {
              grey: "bg-ui-tag-neutral-bg",
              blue: "bg-ui-tag-blue-bg",
              orange: "bg-ui-tag-orange-bg",
              purple: "bg-ui-tag-purple-bg",
              green: "bg-ui-tag-green-bg",
            }

            return (
              <div key={stage.stage} className="flex items-center gap-4">
                <div className="w-28 shrink-0 text-right">
                  <Text size="small" weight="plus" className="capitalize">
                    {stage.stage}
                  </Text>
                </div>
                <div className="flex-1">
                  <div
                    className={`${bgColors[color] || bgColors.grey} rounded h-8 flex items-center px-3 transition-all`}
                    style={{ width: `${widthPercent}%` }}
                  >
                    <Text size="small" weight="plus">
                      {stage.count.toLocaleString()}
                    </Text>
                  </div>
                </div>
                <div className="w-20 shrink-0">
                  {index > 0 && stage.dropoff_rate > 0 ? (
                    <Text size="xsmall" className="text-ui-fg-error">
                      -{stage.dropoff_rate}%
                    </Text>
                  ) : (
                    <Text size="xsmall" className="text-ui-fg-muted">-</Text>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {summary?.biggest_dropoff?.stage && summary.biggest_dropoff.rate > 0 && (
          <div className="mt-4 p-3 bg-ui-bg-subtle rounded-lg">
            <Text size="xsmall" className="text-ui-fg-muted">Biggest drop-off</Text>
            <Text size="small" weight="plus" className="text-ui-fg-error">
              {summary.biggest_dropoff.stage}: {summary.biggest_dropoff.rate}%
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}

// --- Event Log ---

const columnHelper = createDataTableColumnHelper<JourneyEvent>()

const JourneysPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [stageFilter, setStageFilter] = useState<string>("all")
  const [eventFilter, setEventFilter] = useState<string>("all")

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "journeys", limit, offset, stageFilter, eventFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (stageFilter !== "all") params.set("stage", stageFilter)
      if (eventFilter !== "all") params.set("event_type", eventFilter)
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/journeys?${params}`)
      return res
    },
  })

  const columns = useMemo(() => [
    columnHelper.accessor("event_type", {
      header: "Event",
      cell: ({ getValue }) => {
        const type = getValue()
        const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
          purchase: "green",
          form_submit: "blue",
          page_view: "grey",
          ad_click: "purple",
          lead_capture: "orange",
        }
        return (
          <Badge color={colors[type] || "grey"} size="xsmall">
            {type.replace(/_/g, " ")}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("stage", {
      header: "Stage",
      cell: ({ getValue }) => (
        <Badge color={STAGE_COLORS[getValue()] || "grey"} size="xsmall">
          {getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor("channel", {
      header: "Channel",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="capitalize">
          {getValue()}
        </Text>
      ),
    }),
    columnHelper.accessor("person_id", {
      header: "Customer",
      cell: ({ getValue, row }) => {
        const personId = getValue()
        const visitorId = row.original.visitor_id
        if (personId) {
          return (
            <Link to={`/ad-planning/journeys/${personId}`}>
              <Text size="small" leading="compact" className="text-ui-fg-interactive hover:underline font-mono">
                {personId.slice(0, 10)}...
              </Text>
            </Link>
          )
        }
        return (
          <Text size="small" leading="compact" className="text-ui-fg-muted font-mono">
            {visitorId?.slice(0, 10)}...
          </Text>
        )
      },
    }),
    columnHelper.accessor("utm_source", {
      header: "Source",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className={!getValue() ? "text-ui-fg-muted" : ""}>
          {getValue() || "Direct"}
        </Text>
      ),
    }),
    columnHelper.display({
      id: "order",
      header: "Order",
      cell: ({ row }) => {
        const orderId = row.original.event_data?.order_id
        if (!orderId) return <Text className="text-ui-fg-muted">-</Text>
        return (
          <Link to={`/orders/${orderId}`}>
            <Text size="small" leading="compact" className="text-ui-fg-interactive hover:underline font-mono">
              {orderId.slice(0, 10)}...
            </Text>
          </Link>
        )
      },
    }),
    columnHelper.accessor("occurred_at", {
      header: "Time",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {new Date(getValue()).toLocaleString()}
        </Text>
      ),
    }),
  ], [])

  const table = useDataTable({
    data: data?.journeys || [],
    columns,
    getRowId: (journey) => journey.id,
    rowCount: data?.count || 0,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: searchValue,
      onSearchChange: setSearchValue,
    },
  })

  const stages = [
    { value: "all", label: "All Stages" },
    { value: "awareness", label: "Awareness" },
    { value: "interest", label: "Interest" },
    { value: "consideration", label: "Consideration" },
    { value: "intent", label: "Intent" },
    { value: "conversion", label: "Conversion" },
    { value: "retention", label: "Retention" },
    { value: "advocacy", label: "Advocacy" },
  ]

  const eventTypes = [
    { value: "all", label: "All Events" },
    { value: "page_view", label: "Page View" },
    { value: "form_submit", label: "Form Submit" },
    { value: "purchase", label: "Purchase" },
    { value: "ad_click", label: "Ad Click" },
    { value: "lead_capture", label: "Lead Capture" },
    { value: "social_engage", label: "Social Engage" },
  ]

  return (
    <div className="flex flex-col gap-y-3">
      {/* Funnel Visualization */}
      <FunnelChart />

      {/* Event Log */}
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Journey Events</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Customer touchpoint log
              </Text>
            </div>
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search journeys..." />
              <Select
                size="small"
                value={stageFilter}
                onValueChange={setStageFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by stage" />
                </Select.Trigger>
                <Select.Content>
                  {stages.map((s) => (
                    <Select.Item key={s.value} value={s.value}>
                      {s.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Select
                size="small"
                value={eventFilter}
                onValueChange={setEventFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by event" />
                </Select.Trigger>
                <Select.Content>
                  {eventTypes.map((e) => (
                    <Select.Item key={e.value} value={e.value}>
                      {e.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Journeys",
})

export const handle = {
  breadcrumb: () => "Customer Journeys",
}

export default JourneysPage
