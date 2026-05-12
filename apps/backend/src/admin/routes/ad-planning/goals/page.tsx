/**
 * Conversion Goals List Page
 *
 * Lists all goals with filters and a row-level link to detail. The Google
 * Ads mapping configured per goal lives on goal.metadata.google_ads.* and
 * is edited from the detail page — not from this list, since the picker
 * needs context (CID/conversion-action lookups) that's only meaningful one
 * goal at a time.
 */

import {
  Badge,
  Button,
  Container,
  Heading,
  Select,
  StatusBadge,
  Text,
  DataTable,
  createDataTableColumnHelper,
  useDataTable,
  type DataTablePaginationState,
} from "@medusajs/ui"
import { Plus } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { sdk } from "../../../lib/config"

type ConversionGoal = {
  id: string
  name: string
  description: string | null
  goal_type: string
  is_active: boolean
  priority: number
  default_value: number | null
  value_from_event: boolean
  website_id: string | null
  conditions: Record<string, any> | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
}

const GOAL_TYPE_COLORS: Record<
  string,
  "green" | "blue" | "orange" | "purple" | "grey" | "red"
> = {
  purchase: "green",
  lead_form: "blue",
  add_to_cart: "orange",
  page_view: "grey",
  time_on_page: "grey",
  scroll_depth: "purple",
  custom_event: "grey",
}

const GOAL_TYPES = [
  { value: "all", label: "All types" },
  { value: "purchase", label: "Purchase" },
  { value: "lead_form", label: "Lead form" },
  { value: "add_to_cart", label: "Add to cart" },
  { value: "page_view", label: "Page view" },
  { value: "time_on_page", label: "Time on page" },
  { value: "scroll_depth", label: "Scroll depth" },
  { value: "custom_event", label: "Custom event" },
]

const columnHelper = createDataTableColumnHelper<ConversionGoal>()

const ConversionGoalsPage = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const limit = pagination.pageSize
  const offset = pagination.pageIndex * limit

  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "goals", limit, offset, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      })
      if (typeFilter !== "all") {
        params.set("goal_type", typeFilter)
      }
      return sdk.client.fetch<{ goals: ConversionGoal[]; count: number }>(
        `/admin/ad-planning/goals?${params}`,
        { method: "GET" }
      )
    },
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue, row }) => (
          <Link to={`/ad-planning/goals/${row.original.id}`}>
            <Text
              size="small"
              leading="compact"
              weight="plus"
              className="text-ui-fg-interactive hover:underline"
            >
              {getValue()}
            </Text>
          </Link>
        ),
      }),
      columnHelper.accessor("goal_type", {
        header: "Type",
        cell: ({ getValue }) => {
          const type = getValue()
          return (
            <Badge color={GOAL_TYPE_COLORS[type] || "grey"} size="xsmall">
              {type.replace(/_/g, " ")}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("is_active", {
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge color={getValue() ? "green" : "grey"}>
            {getValue() ? "active" : "inactive"}
          </StatusBadge>
        ),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: ({ getValue }) => (
          <Text size="small" leading="compact">
            {getValue()}
          </Text>
        ),
      }),
      columnHelper.accessor("metadata", {
        header: "Conversions (count)",
        cell: ({ getValue }) => {
          const m = (getValue() || {}) as Record<string, any>
          return (
            <Text size="small" leading="compact" weight="plus">
              {m.current_count ?? 0}
            </Text>
          )
        },
      }),
      columnHelper.accessor("metadata", {
        header: "Google Ads",
        id: "google_ads_mapping",
        cell: ({ getValue }) => {
          const m = (getValue() || {}) as Record<string, any>
          const ga = (m.google_ads || {}) as Record<string, any>
          const mapped = !!(ga.conversion_action || ga.customer_id)
          return mapped ? (
            <Badge color="green" size="2xsmall">
              Mapped
            </Badge>
          ) : (
            <Text size="small" leading="compact" className="text-ui-fg-muted">
              —
            </Text>
          )
        },
      }),
    ],
    []
  )

  const table = useDataTable({
    data: data?.goals || [],
    columns,
    getRowId: (g) => g.id,
    rowCount: data?.count || 0,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h2">Conversion goals</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              Define what counts as a conversion. Per-goal Google Ads mapping
              overrides the platform default during upload.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <Select.Trigger className="w-[180px]">
                <Select.Value placeholder="All types" />
              </Select.Trigger>
              <Select.Content>
                {GOAL_TYPES.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Button asChild size="small" variant="primary">
              <Link to="/ad-planning/goals/create">
                <Plus /> Create goal
              </Link>
            </Button>
          </div>
        </div>
        <DataTable instance={table}>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
    </div>
  )
}

// Sidebar entry removed — reached via /admin/ad-planning hub. URL still works.

export const handle = {
  breadcrumb: () => "Goals",
}

export default ConversionGoalsPage
