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
import { sdk } from "../../../lib/config"

interface CustomerScore {
  id: string
  person_id: string
  score_type: string
  score_value: number
  tier: string | null
  percentile: number | null
  display_name: string | null
  person: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
  customer: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
  factors: any
  calculated_at: string
}

const columnHelper = createDataTableColumnHelper<CustomerScore>()

const columns = [
  columnHelper.display({
    id: "customer",
    header: "Customer",
    cell: ({ row }) => {
      const { display_name, person, customer, person_id } = row.original
      const name = display_name
      const email = person?.email || customer?.email

      if (!name && !email) {
        return (
          <Text size="small" leading="compact" className="text-ui-fg-muted font-mono">
            {person_id.slice(0, 12)}...
          </Text>
        )
      }

      return (
        <div className="flex flex-col">
          <Text size="small" leading="compact" weight="plus">
            {name || email}
          </Text>
          {name && email && (
            <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
              {email}
            </Text>
          )}
        </div>
      )
    },
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
        // CLV is computed from conversion_value (store currency), so no conversion needed.
        // Column definition is module-level; use a simple formatter that falls back to store symbol.
        return (
          <Text size="small" leading="compact" weight="plus">
            {new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "EUR",
              minimumFractionDigits: 2,
            }).format(value || 0)}
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
      // Guard against null, undefined, and NaN (insufficient data or missing field)
      if (
        percentile === null ||
        percentile === undefined ||
        Number.isNaN(Number(percentile))
      ) {
        return <Text className="text-ui-fg-muted">-</Text>
      }
      const topPercent = Math.max(0, 100 - Number(percentile))
      return (
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Top {topPercent.toFixed(0)}%
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

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  // Fetch scores
  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "scores", limit, offset, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })
      if (typeFilter !== "all") {
        params.set("score_type", typeFilter)
      }
      const res = await sdk.client.fetch<any>(`/admin/ad-planning/scores?${params}`)
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


  return (
    <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Customer Scores</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                CLV, engagement scores, and churn risk analysis
              </Text>
            </div>
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
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Scores",
})

export const handle = {
  breadcrumb: () => "Customer Scores",
}

export default ScoresPage
