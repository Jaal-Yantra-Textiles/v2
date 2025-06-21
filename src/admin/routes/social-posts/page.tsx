import { Button, Container, DataTable, DataTablePaginationState, Heading, Text, useDataTable, createDataTableFilterHelper, DataTableFilteringState } from "@medusajs/ui"
import { useSocialPosts } from "../../hooks/api/social-posts"
import { useSocialPostTableColumns } from "./hooks/use-social-post-table-columns"
import { useNavigate } from "react-router-dom"
import { AdminSocialPost } from "../../hooks/api/social-posts"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { FolderIllustration } from "@medusajs/icons"
import { useCallback, useState } from "react"
import debounce from "lodash/debounce"

const PAGE_SIZE = 10

const SocialPostPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const { socialPosts, count, isLoading, isError, error } = useSocialPosts({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    ...(filtering.status ? { status: filtering.status as any } : {}),
  })

  const columns = useSocialPostTableColumns()

  // Debounced search change handler
  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch)
    }, 300),
    []
  )

  // Debounced filter change handler
  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters)
    }, 300),
    []
  )

  const filterHelper = createDataTableFilterHelper<AdminSocialPost>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Scheduled", value: "scheduled" },
        { label: "Posted", value: "posted" },
        { label: "Failed", value: "failed" },
        { label: "Archived", value: "archived" },
      ],
    }),
    filterHelper.accessor("posted_at", {
      type: "date",
      label: "Posted At",
      format: "date",
      options: [
        { label: "Today", value: { $gte: new Date().toISOString() } },
        { label: "Yesterday", value: { $gte: new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString() } },
        { label: "This Week", value: { $gte: new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString() } },
        { label: "This Month", value: { $gte: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() } },
        { label: "This Year", value: { $gte: new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000).toISOString() } },
      ]
    }),
    filterHelper.accessor("error_message", {
      type: "select",
      label: "Error Message",
      options: [
        { label: "No Error", value: "" },
        { label: "Error", value: "error" },
      ],
    }),
  ]

  const table = useDataTable({
    data: ( socialPosts || []) as AdminSocialPost[],
    columns,
    rowCount: count,
    filters,
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
    getRowId: (row: AdminSocialPost) => row.id,
    onRowClick: (_, row) => {
      navigate(`/social-posts/${row.id}`)
    },
    isLoading,
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
            <Heading>Social Posts</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your social posts from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search posts..." />
            </div>
            <div className="flex items-center gap-x-2">
                <DataTable.FilterMenu tooltip="Filter posts" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/social-posts/create")}
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
  label: "Social Posts",
  icon: FolderIllustration,
})

export const handle = {
  breadcrumb: () => "Social Posts",
}

export default SocialPostPage
