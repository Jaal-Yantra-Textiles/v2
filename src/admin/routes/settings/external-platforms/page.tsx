import { Button, Container, DataTable, DataTablePaginationState, DataTableFilteringState, Heading, Text, useDataTable, createDataTableFilterHelper } from "@medusajs/ui"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"
import { useSocialPlatformTableColumns } from "./hooks/use-social-platform-table-columns"
import { useNavigate } from "react-router-dom"
import { AdminSocialPlatform } from "../../../hooks/api/social-platforms"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { FolderIllustration } from "@medusajs/icons"
import { useCallback, useState } from "react"
import debounce from "lodash/debounce"

const PAGE_SIZE = 10

const SocialPlatformPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({ 
    pageIndex: 0, 
    pageSize: PAGE_SIZE 
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const { socialPlatforms, count, isLoading, isError, error } = useSocialPlatforms({ 
    limit: pagination.pageSize, 
    offset, 
    q: search || undefined,
    // Apply filtering - transform filter values to match API expectations
    ...(Object.keys(filtering).length > 0 ? 
      Object.entries(filtering).reduce((acc, [key, value]) => {
        // If value is an array, take the first element, otherwise use the value as-is
        acc[key] = Array.isArray(value) ? value[0] : value;
        return acc;
      }, {} as any) : {}),
  })

  const columns = useSocialPlatformTableColumns()

  // Create filters using the filterHelper
  const filterHelper = createDataTableFilterHelper<AdminSocialPlatform>()
  
  const filters = [
    filterHelper.accessor("category", {
      type: "select",
      label: "Category",
      options: [
        { label: "Social Media", value: "social" },
        { label: "Payment", value: "payment" },
        { label: "Shipping", value: "shipping" },
        { label: "Email", value: "email" },
        { label: "SMS", value: "sms" },
        { label: "Analytics", value: "analytics" },
        { label: "CRM", value: "crm" },
        { label: "Storage", value: "storage" },
        { label: "Communication", value: "communication" },
        { label: "Authentication", value: "authentication" },
        { label: "Other", value: "other" },
      ],
    }),
    filterHelper.accessor("auth_type", {
      type: "select",
      label: "Auth Type",
      options: [
        { label: "OAuth 2.0", value: "oauth2" },
        { label: "OAuth 1.0", value: "oauth1" },
        { label: "API Key", value: "api_key" },
        { label: "Bearer Token", value: "bearer" },
        { label: "Basic Auth", value: "basic" },
      ],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
        { label: "Error", value: "error" },
        { label: "Pending", value: "pending" },
      ],
    }),
  ]

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters);
    }, 300),
    []
  );

  const table = useDataTable({
    data: (socialPlatforms || []) as AdminSocialPlatform[],
    columns: columns,
    rowCount: count,
    getRowId: (row: AdminSocialPlatform) => row.id,
    onRowClick: (_, row) => {
      navigate(`/settings/external-platforms/${row.id}`);
    },
    isLoading: isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
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
            <Heading>External Platforms</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your external api + social platforms from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search platforms..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter platforms" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/settings/external-platforms/create")}
              >
                Create
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
    label: "External Platforms",
    icon: FolderIllustration,
  });
  
  export const handle = {
    breadcrumb: () => "External Platforms",
  };
  
  export default SocialPlatformPage