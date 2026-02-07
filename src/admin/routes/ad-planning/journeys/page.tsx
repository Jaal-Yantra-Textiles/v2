/**
 * Customer Journeys Page
 * Visualize customer touchpoints and funnel analysis
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
import { useState } from "react"
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
  occurred_at: string
}

const columnHelper = createDataTableColumnHelper<JourneyEvent>()

const columns = [
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
    cell: ({ getValue }) => {
      const stage = getValue()
      const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
        awareness: "grey",
        interest: "blue",
        consideration: "orange",
        intent: "purple",
        conversion: "green",
        retention: "green",
        advocacy: "green",
      }
      return (
        <Badge color={colors[stage] || "grey"} size="xsmall">
          {stage}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("channel", {
    header: "Channel",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact" className="capitalize">
        {getValue()}
      </Text>
    ),
  }),
  columnHelper.accessor("visitor_id", {
    header: "Visitor",
    cell: ({ getValue, row }) => {
      const visitorId = getValue()
      const personId = row.original.person_id
      return (
        <Text size="small" leading="compact" className="text-ui-fg-subtle font-mono">
          {personId ? `Person: ${personId.slice(0, 8)}...` : visitorId?.slice(0, 12) + "..."}
        </Text>
      )
    },
  }),
  columnHelper.accessor("page_url", {
    header: "Page",
    cell: ({ getValue }) => {
      const url = getValue()
      if (!url) return <Text className="text-ui-fg-muted">-</Text>
      try {
        const path = new URL(url).pathname
        return (
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {path.length > 30 ? path.slice(0, 30) + "..." : path}
          </Text>
        )
      } catch {
        return <Text className="text-ui-fg-muted">{url.slice(0, 30)}</Text>
      }
    },
  }),
  columnHelper.accessor("utm_source", {
    header: "Source",
    cell: ({ getValue }) => {
      const source = getValue()
      return (
        <Text size="small" leading="compact" className={!source ? "text-ui-fg-muted" : ""}>
          {source || "Direct"}
        </Text>
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
]

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

  // Fetch journeys
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "journeys", limit, offset, stageFilter, eventFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (stageFilter !== "all") {
        params.set("stage", stageFilter)
      }
      if (eventFilter !== "all") {
        params.set("event_type", eventFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/journeys?${params}`)
      return res
    },
  })

  // Fetch funnel stats
  const { data: funnelData } = useQuery({
    queryKey: ["ad-planning", "journeys", "funnel"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/journeys/funnel")
      return res
    },
  })

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

  // Calculate funnel metrics
  const funnel = funnelData?.funnel || []
  const getFunnelConversion = (fromStage: string, toStage: string) => {
    const from = funnel.find((f: any) => f.stage === fromStage)?.count || 0
    const to = funnel.find((f: any) => f.stage === toStage)?.count || 0
    if (from === 0) return 0
    return ((to / from) * 100).toFixed(1)
  }

  return (
    <div className="flex flex-col gap-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/ad-planning" className="hover:underline">
              <Text size="small" className="text-ui-fg-subtle hover:text-ui-fg-base">
                Ad Planning
              </Text>
            </Link>
            <Text size="small" className="text-ui-fg-muted">/</Text>
            <Text size="small" weight="plus">Customer Journeys</Text>
          </div>
          <Heading level="h1" className="mt-2">Customer Journeys</Heading>
        </div>
      </div>

      {/* Funnel Visualization */}
      <Container className="p-0">
        <div className="px-6 py-4 border-b border-ui-border-base">
          <Text size="small" leading="compact" weight="plus">
            Customer Funnel
          </Text>
        </div>
        <div className="px-6 py-6">
          <div className="flex items-end justify-between gap-4">
            {funnel.map((stage: any, index: number) => {
              const maxCount = Math.max(...funnel.map((f: any) => f.count))
              const heightPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0

              return (
                <div key={stage.stage} className="flex-1 flex flex-col items-center">
                  {/* Bar */}
                  <div className="w-full flex flex-col items-center mb-2">
                    <Text size="small" weight="plus" className="mb-1">
                      {stage.count.toLocaleString()}
                    </Text>
                    <div
                      className="w-full bg-ui-bg-interactive rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(heightPercent, 10)}px`,
                        minHeight: "20px",
                        maxHeight: "120px",
                      }}
                    />
                  </div>
                  {/* Label */}
                  <Text size="xsmall" className="text-ui-fg-subtle capitalize text-center">
                    {stage.stage}
                  </Text>
                  {/* Conversion rate to next stage */}
                  {index < funnel.length - 1 && (
                    <Text size="xsmall" className="text-ui-fg-muted mt-1">
                      {getFunnelConversion(stage.stage, funnel[index + 1].stage)}% →
                    </Text>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Container>

      {/* Stage Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {funnel.map((stage: any) => (
          <div
            key={stage.stage}
            className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-3"
          >
            <Text size="xsmall" leading="compact" className="text-ui-fg-subtle capitalize">
              {stage.stage}
            </Text>
            <Text size="large" leading="compact" weight="plus" className="mt-1">
              {stage.count.toLocaleString()}
            </Text>
          </div>
        ))}
      </div>

      {/* Journeys Table */}
      <Container className="p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="px-6 py-4">
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

export default JourneysPage
