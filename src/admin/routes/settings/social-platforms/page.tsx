import { Button, Container, DataTable, DataTablePaginationState, Heading, Text, useDataTable } from "@medusajs/ui"
import { useSocialPlatforms } from "../../../hooks/api/social-platforms"
import { useSocialPlatformTableColumns } from "./hooks/use-social-platform-table-columns"
import { useNavigate } from "react-router-dom"
import { AdminSocialPlatform } from "../../../hooks/api/social-platforms"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { FolderIllustration } from "@medusajs/icons"
import { useCallback, useState } from "react"
import debounce from "lodash/debounce"

const PAGE_SIZE = 20

const SocialPlatformPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({ 
    pageIndex: 0, 
    pageSize: PAGE_SIZE 
  })
  const [search, setSearch] = useState("")

  const offset = pagination.pageIndex * pagination.pageSize

  const { socialPlatforms, count, isLoading, isError, error } = useSocialPlatforms({ 
    limit: pagination.pageSize, 
    offset, 
    q: search || undefined 
  })

  const columns = useSocialPlatformTableColumns()

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );

  const table = useDataTable({
    data: (socialPlatforms || []) as AdminSocialPlatform[],
    columns: columns,
    rowCount: count,
    getRowId: (row: AdminSocialPlatform) => row.id,
    onRowClick: (_, row) => {
      navigate(`/settings/social-platforms/${row.id}`);
    },
    isLoading: isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
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
            <Heading>Social Platforms</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your social platforms from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search platforms..." />
            </div>
            <div className="flex items-center gap-x-2">
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/settings/social-platforms/create")}
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
    label: "Social Platforms",
    icon: FolderIllustration,
  });
  
  export const handle = {
    breadcrumb: () => "Social Platforms",
  };
  
  export default SocialPlatformPage