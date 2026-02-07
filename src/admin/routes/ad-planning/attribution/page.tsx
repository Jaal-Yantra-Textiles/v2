/**
 * Attribution Page
 * Campaign attribution analysis and insights
 */

import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  DataTable,
  createDataTableColumnHelper,
  useDataTable,
  DataTablePaginationState,
  Select,
  toast,
} from "@medusajs/ui"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/config"
import { ArrowPath } from "@medusajs/icons"

interface Attribution {
  id: string
  session_id: string
  campaign_id: string | null
  campaign_name: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  attribution_model: string
  attribution_weight: number
  touch_type: string | null
  converted: boolean
  conversion_value: number | null
  attributed_at: string
}

const columnHelper = createDataTableColumnHelper<Attribution>()

const columns = [
  columnHelper.accessor("campaign_name", {
    header: "Campaign",
    cell: ({ getValue, row }) => {
      const name = getValue()
      const source = row.original.utm_source
      return (
        <div>
          <Text size="small" leading="compact" weight="plus">
            {name || "Unknown"}
          </Text>
          {source && (
            <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
              via {source}
            </Text>
          )}
        </div>
      )
    },
  }),
  columnHelper.accessor("utm_source", {
    header: "Source",
    cell: ({ getValue }) => {
      const source = getValue()
      const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
        google: "blue",
        facebook: "purple",
        instagram: "purple",
        meta: "purple",
        email: "green",
        direct: "grey",
      }
      return (
        <Badge color={colors[source?.toLowerCase() || ""] || "grey"} size="xsmall">
          {source || "Direct"}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("utm_medium", {
    header: "Medium",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact" className={!getValue() ? "text-ui-fg-muted" : ""}>
        {getValue() || "-"}
      </Text>
    ),
  }),
  columnHelper.accessor("attribution_model", {
    header: "Model",
    cell: ({ getValue }) => (
      <Badge color="grey" size="xsmall">
        {getValue().replace(/_/g, " ")}
      </Badge>
    ),
  }),
  columnHelper.accessor("touch_type", {
    header: "Touch",
    cell: ({ getValue }) => {
      const touch = getValue()
      const colors: Record<string, "green" | "blue" | "orange"> = {
        first: "green",
        last: "blue",
        middle: "orange",
      }
      return touch ? (
        <Badge color={colors[touch] || "grey"} size="xsmall">
          {touch}
        </Badge>
      ) : (
        <Text className="text-ui-fg-muted">-</Text>
      )
    },
  }),
  columnHelper.accessor("converted", {
    header: "Converted",
    cell: ({ getValue }) => (
      <Badge color={getValue() ? "green" : "grey"} size="xsmall">
        {getValue() ? "Yes" : "No"}
      </Badge>
    ),
  }),
  columnHelper.accessor("conversion_value", {
    header: "Value",
    cell: ({ getValue }) => {
      const value = getValue()
      if (!value) return <Text className="text-ui-fg-muted">-</Text>
      return (
        <Text size="small" leading="compact" weight="plus">
          ₹{(value / 100).toLocaleString()}
        </Text>
      )
    },
  }),
  columnHelper.accessor("attributed_at", {
    header: "Date",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {new Date(getValue()).toLocaleDateString()}
      </Text>
    ),
  }),
]

const AttributionPage = () => {
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [modelFilter, setModelFilter] = useState<string>("all")
  const [sourceFilter, setSourceFilter] = useState<string>("all")

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch attributions
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "attributions", limit, offset, modelFilter, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (modelFilter !== "all") {
        params.set("attribution_model", modelFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/attribution?${params}`)
      return res
    },
  })

  // Fetch summary
  const { data: summary } = useQuery({
    queryKey: ["ad-planning", "attribution", "summary"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/attribution/summary")
      return res
    },
  })

  // Bulk resolve
  const bulkResolve = useMutation({
    mutationFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/attribution/bulk-resolve", {
        method: "POST",
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "attributions"] })
      queryClient.invalidateQueries({ queryKey: ["ad-planning", "attribution", "summary"] })
      toast.success("Attribution resolution started")
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to start resolution")
    },
  })

  const table = useDataTable({
    data: data?.attributions || [],
    columns,
    getRowId: (attr) => attr.id,
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

  const models = [
    { value: "all", label: "All Models" },
    { value: "last_click", label: "Last Click" },
    { value: "first_click", label: "First Click" },
    { value: "linear", label: "Linear" },
    { value: "time_decay", label: "Time Decay" },
    { value: "position_based", label: "Position Based" },
  ]

  const sources = [
    { value: "all", label: "All Sources" },
    { value: "google", label: "Google" },
    { value: "facebook", label: "Facebook" },
    { value: "instagram", label: "Instagram" },
    { value: "email", label: "Email" },
    { value: "direct", label: "Direct" },
  ]

  // Summary stats
  const totalAttributions = summary?.total || 0
  const convertedAttributions = summary?.converted || 0
  const conversionRate = totalAttributions > 0 ? ((convertedAttributions / totalAttributions) * 100).toFixed(1) : 0
  const totalValue = summary?.total_value || 0

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
            <Text size="small" weight="plus">Attribution</Text>
          </div>
          <Heading level="h1" className="mt-2">Campaign Attribution</Heading>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={() => bulkResolve.mutate()}
          isLoading={bulkResolve.isPending}
        >
          <ArrowPath className="mr-2" />
          Resolve Attributions
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Total Attributions
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            {totalAttributions.toLocaleString()}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Conversions
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1 text-ui-fg-positive">
            {convertedAttributions.toLocaleString()}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Conversion Rate
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            {conversionRate}%
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Attributed Revenue
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            ₹{(totalValue / 100).toLocaleString()}
          </Text>
        </div>
      </div>

      {/* Source Breakdown */}
      {summary?.by_source && Object.keys(summary.by_source).length > 0 && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              Attribution by Source
            </Text>
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {Object.entries(summary.by_source).map(([source, data]: [string, any]) => (
                <div key={source} className="p-3 bg-ui-bg-subtle rounded-lg">
                  <Badge
                    color={
                      source.toLowerCase().includes("google")
                        ? "blue"
                        : source.toLowerCase().includes("facebook") ||
                          source.toLowerCase().includes("instagram") ||
                          source.toLowerCase().includes("meta")
                        ? "purple"
                        : source.toLowerCase().includes("email")
                        ? "green"
                        : "grey"
                    }
                    size="xsmall"
                  >
                    {source}
                  </Badge>
                  <Text size="base" weight="plus" className="mt-2 block">
                    {data.count?.toLocaleString() || 0}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    ₹{((data.value || 0) / 100).toLocaleString()} revenue
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </Container>
      )}

      {/* Attributions Table */}
      <Container className="p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="px-6 py-4">
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search attributions..." />
              <Select
                size="small"
                value={modelFilter}
                onValueChange={setModelFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by model" />
                </Select.Trigger>
                <Select.Content>
                  {models.map((m) => (
                    <Select.Item key={m.value} value={m.value}>
                      {m.label}
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
  label: "Attribution",
})

export default AttributionPage
