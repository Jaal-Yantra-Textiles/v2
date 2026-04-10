/**
 * Conversions List Page
 * Displays all conversion events with filtering, summary stats, and drill-down links
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
import { useCurrencyFormatter } from "../../../hooks/api/currency"

interface Conversion {
  id: string
  conversion_type: string
  conversion_name: string | null
  visitor_id: string
  person_id: string | null
  session_id: string | null
  conversion_value: number | null
  currency: string
  order_id: string | null
  platform: string
  utm_source: string | null
  utm_campaign: string | null
  ad_campaign_id: string | null
  converted_at: string
}

const columnHelper = createDataTableColumnHelper<Conversion>()

const ConversionsPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch conversions
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "conversions", limit, offset, searchValue, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (typeFilter !== "all") {
        params.set("conversion_type", typeFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/conversions?${params}`)
      return res
    },
  })

  // Fetch stats for summary
  const { data: stats } = useQuery({
    queryKey: ["ad-planning", "conversions", "stats-summary"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/conversions/stats")
      return res
    },
  })

  const { formatCurrency } = useCurrencyFormatter()

  const columns = useMemo(() => [
    columnHelper.accessor("conversion_type", {
      header: "Type",
      cell: ({ getValue }) => {
        const type = getValue()
        const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
          purchase: "green",
          lead_form_submission: "blue",
          add_to_cart: "orange",
          begin_checkout: "purple",
        }
        return (
          <Badge color={colors[type] || "grey"} size="xsmall">
            {type.replace(/_/g, " ")}
          </Badge>
        )
      },
    }),
    columnHelper.accessor("conversion_value", {
      header: "Value",
      cell: ({ getValue }) => {
        const value = getValue()
        if (!value) return <Text className="text-ui-fg-muted">-</Text>
        // Conversion values are already in store currency (from order.total)
        return (
          <Text size="small" leading="compact" weight="plus">
            {formatCurrency(value, { convert: false })}
          </Text>
        )
      },
    }),
    columnHelper.accessor("order_id", {
      header: "Order",
      cell: ({ getValue }) => {
        const orderId = getValue()
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
    columnHelper.accessor("utm_campaign", {
      header: "Campaign",
      cell: ({ getValue }) => {
        const campaign = getValue()
        if (!campaign) return <Text className="text-ui-fg-muted">-</Text>
        return (
          <Link to={`/ad-planning/attribution?utm_campaign=${encodeURIComponent(campaign)}`}>
            <Text size="small" leading="compact" className="text-ui-fg-interactive hover:underline">
              {campaign}
            </Text>
          </Link>
        )
      },
    }),
    columnHelper.accessor("person_id", {
      header: "Customer",
      cell: ({ getValue, row }) => {
        const personId = getValue()
        const visitorId = row.original.visitor_id
        if (personId) {
          return (
            <Link to={`/ad-planning/journeys?person_id=${personId}`}>
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
    columnHelper.accessor("platform", {
      header: "Platform",
      cell: ({ getValue }) => (
        <Badge color="grey" size="xsmall">
          {getValue()}
        </Badge>
      ),
    }),
    columnHelper.accessor("converted_at", {
      header: "Date",
      cell: ({ getValue }) => (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {new Date(getValue()).toLocaleString()}
        </Text>
      ),
    }),
  ], [])

  const table = useDataTable({
    data: data?.conversions || [],
    columns,
    getRowId: (conversion) => conversion.id,
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

  const conversionTypes = [
    { value: "all", label: "All Types" },
    { value: "purchase", label: "Purchase" },
    { value: "lead_form_submission", label: "Lead Form" },
    { value: "add_to_cart", label: "Add to Cart" },
    { value: "begin_checkout", label: "Begin Checkout" },
    { value: "scroll_depth", label: "Scroll Depth" },
    { value: "time_on_site", label: "Time on Site" },
  ]

  // API returns { totals: { total_value, total_conversions, by_type, ... }, time_series }
  const totalValue = stats?.totals?.total_value || 0
  const totalConversions = stats?.totals?.total_conversions || 0
  const purchaseCount = stats?.totals?.by_type?.purchase || 0

  return (
    <div className="flex flex-col gap-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="xsmall" className="text-ui-fg-subtle">Total Conversions</Text>
          <Text size="xlarge" weight="plus" className="mt-1">{totalConversions.toLocaleString()}</Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="xsmall" className="text-ui-fg-subtle">Total Value</Text>
          <Text size="xlarge" weight="plus" className="mt-1 text-ui-fg-positive">
            {formatCurrency(totalValue, { convert: false })}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="xsmall" className="text-ui-fg-subtle">Purchases</Text>
          <Text size="xlarge" weight="plus" className="mt-1">{purchaseCount.toLocaleString()}</Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="xsmall" className="text-ui-fg-subtle">Avg Value</Text>
          <Text size="xlarge" weight="plus" className="mt-1">
            {totalConversions > 0
              ? formatCurrency(totalValue / totalConversions, { convert: false })
              : "-"}
          </Text>
        </div>
      </div>

      {/* Data Table */}
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Conversions</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Track and analyze conversion events
              </Text>
            </div>
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search conversions..." />
              <Select
                size="small"
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by type" />
                </Select.Trigger>
                <Select.Content>
                  {conversionTypes.map((type) => (
                    <Select.Item key={type.value} value={type.value}>
                      {type.label}
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
  label: "Conversions",
})

export const handle = {
  breadcrumb: () => "Conversions",
}

export default ConversionsPage
