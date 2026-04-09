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
import { useState, useMemo } from "react"
import { sdk } from "../../../lib/config"
import { ArrowPath } from "@medusajs/icons"

interface Attribution {
  id: string
  analytics_session_id: string
  ad_campaign_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  platform: string
  is_resolved: boolean
  resolution_confidence: number
  resolution_method: string
  entry_page: string | null
  session_pageviews: number
  attributed_at: string
  campaign_spend?: number | null
}

const columnHelper = createDataTableColumnHelper<Attribution>()

const columns = [
  columnHelper.accessor("utm_campaign", {
    header: "Campaign",
    cell: ({ getValue, row }) => {
      const campaign = getValue()
      const source = row.original.utm_source
      return (
        <div>
          <Text size="small" leading="compact" weight="plus">
            {campaign || "Unknown"}
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
  columnHelper.accessor("platform", {
    header: "Platform",
    cell: ({ getValue }) => {
      const platform = getValue()
      const colors: Record<string, "green" | "blue" | "purple" | "grey"> = {
        meta: "purple",
        google: "blue",
        generic: "grey",
      }
      return (
        <Badge color={colors[platform] || "grey"} size="xsmall">
          {platform}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("is_resolved", {
    header: "Resolved",
    cell: ({ getValue }) => (
      <Badge color={getValue() ? "green" : "grey"} size="xsmall">
        {getValue() ? "Yes" : "No"}
      </Badge>
    ),
  }),
  columnHelper.accessor("resolution_method", {
    header: "Method",
    cell: ({ getValue }) => {
      const method = getValue()
      if (!method || method === "unresolved") return <Text className="text-ui-fg-muted">-</Text>
      return (
        <Badge color="grey" size="xsmall">
          {method.replace(/_/g, " ")}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("session_pageviews", {
    header: "Pageviews",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact">
        {getValue()}
      </Text>
    ),
  }),
  columnHelper.accessor("campaign_spend", {
    header: "Ad Spend",
    cell: ({ getValue, row }) => {
      const spend = getValue()
      if (!spend) return <Text className="text-ui-fg-muted">-</Text>
      // Meta Ads spend is stored in account currency (e.g. INR).
      // Show as-is with the campaign's own currency symbol.
      const currency = (row.original as any).campaign_currency || "INR"
      return (
        <Text size="small" leading="compact">
          {new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: currency.toUpperCase(),
            minimumFractionDigits: 2,
          }).format(spend)}
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

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch attributions
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "attributions", limit, offset, modelFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (modelFilter !== "all") {
        params.set("is_resolved", modelFilter === "resolved" ? "true" : "false")
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/attribution?${params}`)
      return res
    },
  })

  // Fetch meta-ads campaigns for spend enrichment
  const { data: campaignsData } = useQuery({
    queryKey: ["meta-ads", "campaigns", "attribution-enrichment"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{
        campaigns: any[]
        count: number
      }>("/admin/meta-ads/campaigns?limit=100")
      return res
    },
  })

  // Build campaign lookup by name (lowercased)
  const campaignLookup = useMemo(() => {
    const lookup: Record<string, any> = {}
    for (const c of campaignsData?.campaigns || []) {
      if (c.name) lookup[c.name.toLowerCase()] = c
    }
    return lookup
  }, [campaignsData])

  // Enrich attributions with campaign spend
  const enrichedAttributions = useMemo(() => {
    return (data?.attributions || []).map((attr: Attribution) => {
      const key = (
        attr.utm_campaign ||
        ""
      ).toLowerCase()
      const matched = campaignLookup[key]
      return {
        ...attr,
        campaign_spend: matched?.spend || null,
      }
    })
  }, [data?.attributions, campaignLookup])

  // Bulk resolve
  const bulkResolve = useMutation({
    mutationFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/attribution/resolve", {
        method: "POST",
        body: { bulk: true },
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
    data: enrichedAttributions,
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

  const statusFilters = [
    { value: "all", label: "All Attributions" },
    { value: "resolved", label: "Resolved" },
    { value: "unresolved", label: "Unresolved" },
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
                  <Select.Value placeholder="Filter by status" />
                </Select.Trigger>
                <Select.Content>
                  {statusFilters.map((m) => (
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
