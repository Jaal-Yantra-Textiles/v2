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
  toast,
  Select,
} from "@medusajs/ui"
import { useLeads, Lead, LeadStatus, useSyncLeads } from "../../../hooks/api/meta-ads"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"
import { useNavigate, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { UsersSolid, ArrowPath } from "@medusajs/icons"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { createColumnHelper } from "@tanstack/react-table"

const PAGE_SIZE = 10

// Helper to parse URL params to filter state
const parseFiltersFromParams = (searchParams: URLSearchParams): DataTableFilteringState => {
  const filters: DataTableFilteringState = {}
  const status = searchParams.get("status")
  const platform_id = searchParams.get("platform_id")
  const q = searchParams.get("q")
  if (status) filters.status = status
  if (platform_id) filters.platform_id = platform_id
  if (q) filters.q = q
  return filters
}

// Helper to build URL params from filter state
const buildParamsFromFilters = (
  filters: DataTableFilteringState,
  pagination: DataTablePaginationState
): URLSearchParams => {
  const params = new URLSearchParams()
  
  if (filters.status) params.set("status", filters.status as string)
  if (filters.platform_id) params.set("platform_id", filters.platform_id as string)
  if (filters.q) params.set("q", filters.q as string)
  if (pagination.pageIndex > 0) params.set("page", String(pagination.pageIndex + 1))
  if (pagination.pageSize !== PAGE_SIZE) params.set("limit", String(pagination.pageSize))
  
  return params
}

const columnHelper = createColumnHelper<Lead>()

const getStatusBadgeColor = (status: LeadStatus): "green" | "orange" | "blue" | "red" | "grey" | "purple" => {
  switch (status) {
    case "new": return "blue"
    case "contacted": return "orange"
    case "qualified": return "purple"
    case "unqualified": return "grey"
    case "converted": return "green"
    case "lost": return "red"
    case "archived": return "grey"
    default: return "grey"
  }
}

const LeadsPage = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [syncPlatformId, setSyncPlatformId] = useState<string | null>(null)
  
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

  const { data, isLoading, isError, error } = useLeads({
    limit: pagination.pageSize,
    offset,
    status: filtering.status as LeadStatus | undefined,
    platform_id: filtering.platform_id as string | undefined,
    q: filtering.q as string | undefined,
  })
  
  const { socialPlatforms } = useSocialPlatforms({ limit: 100 })
  const syncMutation = useSyncLeads()
  
  // Update URL when pagination changes
  const handlePaginationChange = useCallback((newPagination: DataTablePaginationState) => {
    const params = buildParamsFromFilters(filtering, newPagination)
    setSearchParams(params, { replace: true })
  }, [filtering, setSearchParams])
  
  // Update URL when filters change
  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      const params = buildParamsFromFilters(newFilters, { pageIndex: 0, pageSize: pagination.pageSize })
      setSearchParams(params, { replace: true })
    }, 300),
    [pagination.pageSize, setSearchParams]
  )

  // Filter to only show Facebook/Instagram platforms (Meta platforms)
  const metaPlatforms = useMemo(() => {
    return socialPlatforms?.filter(p => 
      p.name.toLowerCase().includes('facebook') || 
      p.name.toLowerCase().includes('instagram') ||
      p.name.toLowerCase().includes('meta')
    ) || []
  }, [socialPlatforms])

  const handleSync = async () => {
    if (!syncPlatformId) {
      toast.error("Please select a platform to sync from")
      return
    }
    
    try {
      const result = await syncMutation.mutateAsync({ platform_id: syncPlatformId })
      const { synced, errors, error_messages } = result.results
      
      if (errors > 0 && synced === 0) {
        // All failed
        toast.error(error_messages?.[0] || "Failed to sync leads")
      } else if (errors > 0) {
        // Partial success
        toast.warning(`Synced ${synced} leads, ${errors} failed`)
      } else {
        toast.success(`Synced ${synced} leads from Meta`)
      }
    } catch (e: any) {
      // Extract error message from response if available
      const errorMsg = e.body?.results?.error_messages?.[0] || e.message || "Failed to sync leads"
      toast.error(errorMsg)
    }
  }

  const leads = data?.leads || []
  const count = data?.total || 0

  const columns = useMemo(() => [
    columnHelper.accessor("full_name", {
      header: "Name",
      cell: ({ getValue, row }) => {
        const fullName = getValue()
        const firstName = row.original.first_name
        const lastName = row.original.last_name
        const displayName = fullName || [firstName, lastName].filter(Boolean).join(" ") || "—"
        return <span className="font-medium">{displayName}</span>
      },
    }),
    columnHelper.accessor("email", {
      header: "Email",
      cell: ({ getValue }) => getValue() || "—",
    }),
    columnHelper.accessor("phone", {
      header: "Phone",
      cell: ({ getValue }) => getValue() || "—",
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
    // columnHelper.accessor("campaign_name", {
    //   header: "Campaign",
    //   cell: ({ getValue }) => getValue() || "—",
    // }),
    // columnHelper.accessor("ad_name", {
    //   header: "Ad",
    //   cell: ({ getValue }) => getValue() || "—",
    // }),
    columnHelper.accessor("created_time", {
      header: "Received",
      cell: ({ getValue }) => {
        const date = getValue()
        if (!date) return "—"
        return new Date(date).toLocaleString()
      },
    }),
  ], [])

  const filterHelper = createDataTableFilterHelper<Lead>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "New", value: "new" },
        { label: "Contacted", value: "contacted" },
        { label: "Qualified", value: "qualified" },
        { label: "Unqualified", value: "unqualified" },
        { label: "Converted", value: "converted" },
        { label: "Lost", value: "lost" },
        { label: "Archived", value: "archived" },
      ],
    }),
  ]

  const table = useDataTable({
    data: leads,
    columns,
    rowCount: count,
    filters,
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
    search: {
      state: filtering.q as string || "",
      onSearchChange: (value) => {
        handleFilterChange({ ...filtering, q: value })
      },
    },
    getRowId: (row) => row.id,
    onRowClick: (_, row) => {
      navigate(`/meta-ads/leads/${row.id}`)
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
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Meta Leads</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage leads from Meta Lead Ads
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.FilterMenu tooltip="Filter leads" />
            <DataTable.Search placeholder="Search leads..." />
          </div>
        </DataTable.Toolbar>
        {/* Sync controls row */}
        <div className="flex items-center justify-between gap-x-2 w-full px-6 py-4">
          <div className="flex items-center gap-x-2">
            <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">Sync from:</Text>
            <Select 
              size="small"
              value={syncPlatformId || ""}
              onValueChange={(value) => setSyncPlatformId(value)}
            >
              <Select.Trigger className="w-[300px]">
                <Select.Value placeholder="Select platform..." />
              </Select.Trigger>
              <Select.Content>
                {metaPlatforms.map((platform) => (
                  <Select.Item key={platform.id} value={platform.id}>
                    {platform.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <Button
            size="small"
            variant="secondary"
            className="min-w-[80px]"
            onClick={handleSync}
            isLoading={syncMutation.isPending}
            disabled={!syncPlatformId || metaPlatforms.length === 0}
          >
            {!syncMutation.isPending && <ArrowPath className="mr-1" />}
            Sync
          </Button>
        </div>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Meta Leads",
  nested: '/promotions',
  icon: UsersSolid,
})

export const handle = {
  breadcrumb: () => "Meta Leads",
}

export default LeadsPage
