/**
 * Customer Scores Page
 * View customer CLV, engagement scores, and churn risk
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

interface CustomerScore {
  id: string
  person_id: string
  score_type: string
  score_value: number
  tier: string | null
  percentile: number | null
  factors: any
  calculated_at: string
}

const columnHelper = createDataTableColumnHelper<CustomerScore>()

const columns = [
  columnHelper.accessor("person_id", {
    header: "Customer",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact" className="font-mono">
        {getValue().slice(0, 12)}...
      </Text>
    ),
  }),
  columnHelper.accessor("score_type", {
    header: "Score Type",
    cell: ({ getValue }) => {
      const type = getValue()
      const colors: Record<string, "green" | "blue" | "orange" | "purple" | "grey"> = {
        clv: "green",
        engagement: "blue",
        churn_risk: "orange",
        nps: "purple",
      }
      const labels: Record<string, string> = {
        clv: "CLV",
        engagement: "Engagement",
        churn_risk: "Churn Risk",
        nps: "NPS",
      }
      return (
        <Badge color={colors[type] || "grey"} size="xsmall">
          {labels[type] || type}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("score_value", {
    header: "Score",
    cell: ({ getValue, row }) => {
      const value = getValue()
      const type = row.original.score_type

      if (type === "clv") {
        return (
          <Text size="small" leading="compact" weight="plus">
            ₹{value.toLocaleString()}
          </Text>
        )
      }

      if (type === "churn_risk") {
        const color = value > 70 ? "text-ui-fg-error" : value > 40 ? "text-ui-fg-warning" : "text-ui-fg-positive"
        return (
          <Text size="small" leading="compact" weight="plus" className={color}>
            {value}%
          </Text>
        )
      }

      return (
        <Text size="small" leading="compact" weight="plus">
          {value}
        </Text>
      )
    },
  }),
  columnHelper.accessor("tier", {
    header: "Tier",
    cell: ({ getValue }) => {
      const tier = getValue()
      if (!tier) return <Text className="text-ui-fg-muted">-</Text>

      const colors: Record<string, "green" | "blue" | "orange" | "grey"> = {
        platinum: "green",
        gold: "blue",
        silver: "orange",
        bronze: "grey",
        high: "green",
        medium: "blue",
        low: "grey",
      }
      return (
        <Badge color={colors[tier.toLowerCase()] || "grey"} size="xsmall">
          {tier}
        </Badge>
      )
    },
  }),
  columnHelper.accessor("percentile", {
    header: "Percentile",
    cell: ({ getValue }) => {
      const percentile = getValue()
      if (percentile === null) return <Text className="text-ui-fg-muted">-</Text>
      return (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Top {(100 - percentile).toFixed(0)}%
        </Text>
      )
    },
  }),
  columnHelper.accessor("calculated_at", {
    header: "Calculated",
    cell: ({ getValue }) => (
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {new Date(getValue()).toLocaleDateString()}
      </Text>
    ),
  }),
]

const ScoresPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [searchValue, setSearchValue] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [tierFilter, setTierFilter] = useState<string>("all")

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch scores
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "scores", limit, offset, typeFilter, tierFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (typeFilter !== "all") {
        params.set("score_type", typeFilter)
      }
      if (tierFilter !== "all") {
        params.set("tier", tierFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/scores?${params}`)
      return res
    },
  })

  // Fetch tier distribution
  const { data: tierStats } = useQuery({
    queryKey: ["ad-planning", "scores", "tiers"],
    queryFn: async () => {
      const res = await sdk.client.fetch<any>("/admin/ad-planning/scores/tier-distribution")
      return res
    },
  })

  const table = useDataTable({
    data: data?.scores || [],
    columns,
    getRowId: (score) => score.id,
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

  const scoreTypes = [
    { value: "all", label: "All Types" },
    { value: "clv", label: "Customer Lifetime Value" },
    { value: "engagement", label: "Engagement Score" },
    { value: "churn_risk", label: "Churn Risk" },
    { value: "nps", label: "NPS Score" },
  ]

  const tiers = [
    { value: "all", label: "All Tiers" },
    { value: "platinum", label: "Platinum" },
    { value: "gold", label: "Gold" },
    { value: "silver", label: "Silver" },
    { value: "bronze", label: "Bronze" },
  ]

  // Calculate tier distribution for visualization
  const distribution = tierStats?.distribution || []
  const totalCustomers = distribution.reduce((acc: number, t: any) => acc + t.count, 0)

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
            <Text size="small" weight="plus">Customer Scores</Text>
          </div>
          <Heading level="h1" className="mt-2">Customer Scores</Heading>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Total Scored Customers
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            {totalCustomers.toLocaleString()}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Avg CLV
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            ₹{(tierStats?.avg_clv || 0).toLocaleString()}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Avg Engagement
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1">
            {(tierStats?.avg_engagement || 0).toFixed(1)}
          </Text>
        </div>
        <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-lg p-4">
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            High Churn Risk
          </Text>
          <Text size="xlarge" leading="compact" weight="plus" className="mt-1 text-ui-fg-error">
            {(tierStats?.high_churn_count || 0).toLocaleString()}
          </Text>
        </div>
      </div>

      {/* Tier Distribution */}
      {distribution.length > 0 && (
        <Container className="p-0">
          <div className="px-6 py-4 border-b border-ui-border-base">
            <Text size="small" leading="compact" weight="plus">
              Customer Tier Distribution
            </Text>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center gap-2 mb-4">
              {distribution.map((tier: any) => {
                const percent = totalCustomers > 0 ? (tier.count / totalCustomers) * 100 : 0
                const colors: Record<string, string> = {
                  platinum: "bg-ui-tag-green-bg",
                  gold: "bg-ui-tag-blue-bg",
                  silver: "bg-ui-tag-orange-bg",
                  bronze: "bg-ui-tag-neutral-bg",
                }
                return (
                  <div
                    key={tier.tier}
                    className={`h-8 ${colors[tier.tier.toLowerCase()] || "bg-ui-bg-subtle"} rounded`}
                    style={{ width: `${Math.max(percent, 5)}%` }}
                    title={`${tier.tier}: ${tier.count} (${percent.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
            <div className="flex items-center justify-between">
              {distribution.map((tier: any) => (
                <div key={tier.tier} className="flex items-center gap-2">
                  <Badge
                    color={
                      tier.tier.toLowerCase() === "platinum"
                        ? "green"
                        : tier.tier.toLowerCase() === "gold"
                        ? "blue"
                        : tier.tier.toLowerCase() === "silver"
                        ? "orange"
                        : "grey"
                    }
                    size="xsmall"
                  >
                    {tier.tier}
                  </Badge>
                  <Text size="small" className="text-ui-fg-subtle">
                    {tier.count.toLocaleString()}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        </Container>
      )}

      {/* Scores Table */}
      <Container className="p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="px-6 py-4">
            <div className="flex items-center gap-4">
              <DataTable.Search placeholder="Search by customer..." />
              <Select
                size="small"
                value={typeFilter}
                onValueChange={setTypeFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by type" />
                </Select.Trigger>
                <Select.Content>
                  {scoreTypes.map((t) => (
                    <Select.Item key={t.value} value={t.value}>
                      {t.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Select
                size="small"
                value={tierFilter}
                onValueChange={setTierFilter}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Filter by tier" />
                </Select.Trigger>
                <Select.Content>
                  {tiers.map((t) => (
                    <Select.Item key={t.value} value={t.value}>
                      {t.label}
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
  label: "Scores",
})

export default ScoresPage
