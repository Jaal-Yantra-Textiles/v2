import { 
  Button, 
  Container, 
  DataTable, 
  DataTablePaginationState, 
  Heading, 
  Text, 
  useDataTable,
  StatusBadge,
  createDataTableFilterHelper,
  DataTableFilteringState,
} from "@medusajs/ui"
import { useCampaigns, Campaign } from "../../hooks/api/publishing-campaigns"
import { useNavigate, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Calendar } from "@medusajs/icons"
import { useCallback, useMemo } from "react"
import debounce from "lodash/debounce"
import { createColumnHelper } from "@tanstack/react-table"

const PAGE_SIZE = 10

// Helper to parse URL params to filter state
const parseFiltersFromParams = (searchParams: URLSearchParams): DataTableFilteringState => {
  const filters: DataTableFilteringState = {}
  const status = searchParams.get("status")
  if (status) {
    filters.status = status
  }
  return filters
}

// Helper to build URL params from filter state
const buildParamsFromFilters = (
  filters: DataTableFilteringState,
  pagination: DataTablePaginationState
): URLSearchParams => {
  const params = new URLSearchParams()
  
  if (filters.status) {
    params.set("status", filters.status as string)
  }
  if (pagination.pageIndex > 0) {
    params.set("page", String(pagination.pageIndex + 1))
  }
  if (pagination.pageSize !== PAGE_SIZE) {
    params.set("limit", String(pagination.pageSize))
  }
  
  return params
}

const columnHelper = createColumnHelper<Campaign>()

const getStatusBadgeColor = (status: Campaign["status"]): "green" | "orange" | "blue" | "red" | "grey" | "purple" => {
  switch (status) {
    case "active":
      return "green"
    case "paused":
      return "orange"
    case "completed":
      return "blue"
    case "cancelled":
      return "red"
    case "draft":
      return "grey"
    case "preview":
      return "purple"
    default:
      return "grey"
  }
}

const PublishingCampaignsPage = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  
  // Parse pagination from URL
  const pageFromUrl = parseInt(searchParams.get("page") || "1", 10)
  const limitFromUrl = parseInt(searchParams.get("limit") || String(PAGE_SIZE), 10)
  
  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: limitFromUrl,
  }
  
  // Parse filters from URL
  const filtering = parseFiltersFromParams(searchParams)
  
  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useCampaigns({
    limit: pagination.pageSize,
    offset,
    status: filtering.status as string | undefined,
  })
  
  // Update URL when pagination changes
  const handlePaginationChange = useCallback((newPagination: DataTablePaginationState) => {
    const params = buildParamsFromFilters(filtering, newPagination)
    setSearchParams(params, { replace: true })
  }, [filtering, setSearchParams])
  
  // Update URL when filters change
  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      // Reset to page 1 when filters change
      const params = buildParamsFromFilters(newFilters, { pageIndex: 0, pageSize: pagination.pageSize })
      setSearchParams(params, { replace: true })
    }, 300),
    [pagination.pageSize, setSearchParams]
  )

  const campaigns = data?.campaigns || []
  const count = data?.count || 0

  const columns = useMemo(() => [
    columnHelper.accessor("name", {
      header: "Name",
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue()}</span>
      ),
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue()
        return (
          <StatusBadge color={getStatusBadgeColor(status)}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </StatusBadge>
        )
      },
    }),
    columnHelper.accessor("platform", {
      header: "Platform",
      cell: ({ getValue }) => getValue()?.name || "—",
    }),
    columnHelper.accessor("items", {
      header: "Progress",
      cell: ({ getValue, row }) => {
        const items = getValue() || []
        const stats = row.original.stats
        if (stats) {
          return (
            <span className="text-ui-fg-subtle">
              {stats.published}/{stats.total} published
              {stats.failed > 0 && (
                <span className="text-ui-fg-error ml-1">
                  ({stats.failed} failed)
                </span>
              )}
            </span>
          )
        }
        return `${items.length} items`
      },
    }),
    columnHelper.accessor("interval_hours", {
      header: "Interval",
      cell: ({ getValue }) => `${getValue()}h`,
    }),
    columnHelper.accessor("next_publish_at", {
      header: "Next Publish",
      cell: ({ getValue }) => {
        const date = getValue()
        if (!date) return "—"
        return new Date(date).toLocaleString()
      },
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
    }),
  ], [])

  const filterHelper = createDataTableFilterHelper<Campaign>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Preview", value: "preview" },
        { label: "Active", value: "active" },
        { label: "Paused", value: "paused" },
        { label: "Completed", value: "completed" },
        { label: "Cancelled", value: "cancelled" },
      ],
    }),
  ]

  const table = useDataTable({
    data: campaigns,
    columns,
    rowCount: count,
    filters,
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
    getRowId: (row) => row.id,
    onRowClick: (_, row) => {
      navigate(`/publishing-campaigns/${row.id}`)
    },
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: handlePaginationChange,
    },
  })

  if (isError) {
    throw error
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Publishing Campaigns</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Automate social media posting with scheduled campaigns
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter campaigns" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/social-posts/create?campaign=true")}
              >
                Create Campaign
              </Button>
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Publishing Campaigns",
  nested: '/promotions',
  icon: Calendar,
})

export const handle = {
  breadcrumb: () => "Publishing Campaigns",
}

export default PublishingCampaignsPage
