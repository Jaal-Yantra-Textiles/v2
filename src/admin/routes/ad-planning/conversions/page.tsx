/**
 * Conversions List Page
 * Displays all conversion events with filtering and search
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

interface Conversion {
  id: string
  conversion_type: string
  conversion_name: string | null
  visitor_id: string
  session_id: string | null
  conversion_value: number | null
  currency: string
  order_id: string | null
  platform: string
  utm_source: string | null
  utm_campaign: string | null
  converted_at: string
}

const columnHelper = createDataTableColumnHelper<Conversion>()

const columns = [
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
    cell: ({ getValue, row }) => {
      const value = getValue()
      const currency = row.original.currency
      if (!value) return <Text className="text-ui-fg-muted">-</Text>
      return (
        <Text size="small" leading="compact">
          {currency === "INR" ? "₹" : currency} {(value / 100).toLocaleString()}
        </Text>
      )
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
  columnHelper.accessor("utm_campaign", {
    header: "Campaign",
    cell: ({ getValue }) => {
      const campaign = getValue()
      return (
        <Text size="small" leading="compact" className={!campaign ? "text-ui-fg-muted" : ""}>
          {campaign || "-"}
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
]

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

  return (
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
  )
}

export const config = defineRouteConfig({
  label: "Conversions",
})

export const handle = {
  breadcrumb: () => "Conversions",
}

export default ConversionsPage
