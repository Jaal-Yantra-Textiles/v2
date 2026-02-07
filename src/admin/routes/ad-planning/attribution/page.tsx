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

  return (
    <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Campaign Attribution</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Campaign attribution analysis and insights
              </Text>
            </div>
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
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Attribution",
})

export const handle = {
  breadcrumb: () => "Attribution",
}

export default AttributionPage
