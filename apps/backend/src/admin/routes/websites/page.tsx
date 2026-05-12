import {
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Text,
  createDataTableFilterHelper,
  useDataTable,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import debounce from "lodash/debounce"
import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"

import { AdminWebsite, useWebsites } from "../../hooks/api/websites"
import { useWebsiteTableColumns } from "./hooks/use-website-table-columns"

const PAGE_SIZE = 20

const WebsitesPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const statusFilter = filtering.status
  const statusValue = Array.isArray(statusFilter) ? statusFilter[0] : statusFilter

  const { websites, count, isLoading, isError, error } = useWebsites(
    {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
      ...(statusValue ? { status: statusValue as AdminWebsite["status"] } : {}),
    },
    { placeholderData: keepPreviousData }
  )

  const columns = useWebsiteTableColumns()

  const filterHelper = createDataTableFilterHelper<AdminWebsite>()
  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "Active" },
        { label: "Inactive", value: "Inactive" },
        { label: "Maintenance", value: "Maintenance" },
        { label: "Development", value: "Development" },
      ],
    }),
  ]

  const handleSearchChange = useCallback(
    debounce((next: string) => setSearch(next), 300),
    []
  )

  const handleFilterChange = useCallback(
    debounce((next: DataTableFilteringState) => setFiltering(next), 300),
    []
  )

  const table = useDataTable({
    data: (websites ?? []) as AdminWebsite[],
    columns,
    rowCount: count ?? 0,
    getRowId: (row: AdminWebsite) => row.id,
    onRowClick: (_, row) => navigate(`/websites/${row.id}`),
    isLoading,
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
            <Heading>Websites</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your websites from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search websites..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter websites" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/websites/create")}
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

export default WebsitesPage

// Sidebar entry removed — reached via /admin/content hub. URL still works.

export const handle = {
  breadcrumb: () => "Websites",
}
