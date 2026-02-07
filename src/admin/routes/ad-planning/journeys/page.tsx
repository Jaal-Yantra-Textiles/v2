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
    <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Customer Journeys</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Visualize customer touchpoints and funnel analysis
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
  )
}

export const config = defineRouteConfig({
  label: "Journeys",
})

export const handle = {
  breadcrumb: () => "Customer Journeys",
}

export default JourneysPage
