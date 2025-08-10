import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, Button } from "@medusajs/ui"
import { Link, Outlet, useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { UserGroup, Users } from "@medusajs/icons"
import { useMemo, useState, useCallback } from "react"
import debounce from "lodash/debounce"
import { usePartners } from "../../hooks/api/partners-admin"
import type { AdminPartner } from "../../hooks/api/partners-admin"
import { usePartnerTableColumns } from "../../hooks/columns/usePartnerTableColumns"

export const useColumns = () => {
  const columns = usePartnerTableColumns()
  return useMemo(() => [...columns], [columns])
}

const PartnersPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => setFiltering(newFilters), 300),
    [],
  )
  const handleSearchChange = useCallback(debounce((q: string) => setSearch(q), 300), [])

  const offset = pagination.pageIndex * pagination.pageSize

  const { partners = [], count = 0, isPending } = usePartners({
    limit: pagination.pageSize,
    offset,
    // Apply known filters only
    ...(Object.keys(filtering).length > 0
      ? Object.entries(filtering).reduce((acc: Record<string, any>, [key, value]) => {
          if (!value) return acc
          if (key === "status") acc.status = Array.isArray(value) ? value[0] : value
          if (key === "is_verified") acc.is_verified = Array.isArray(value) ? value[0] === "true" : value === "true"
          if (key === "name") acc.name = Array.isArray(value) ? value[0] : value
          if (key === "handle") acc.handle = Array.isArray(value) ? value[0] : value
          return acc
        }, {})
      : {}),
  }) as any

  const columns = useColumns()
  const filterHelper = createDataTableFilterHelper<AdminPartner>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
        { label: "Pending", value: "pending" },
      ],
    }),
    filterHelper.accessor("is_verified", {
      type: "select",
      label: "Verified",
      options: [
        { label: "True", value: "true" },
        { label: "False", value: "false" },
      ],
    }),
    filterHelper.accessor("name", {
      type: "select",
      label: "Name",
      options: useMemo(() => {
        const names = [...new Set(partners.map((p: any) => p.name).filter(Boolean))]
        return names.map((n) => ({ label: String(n), value: String(n) })) as { label: string; value: string }[]
      }, [partners]),
    }),
    filterHelper.accessor("handle", {
      type: "select",
      label: "Handle",
      options: useMemo(() => {
        const handles = [...new Set(partners.map((p: any) => p.handle).filter(Boolean))]
        return handles.map((h) => ({ label: String(h), value: String(h) })) as { label: string; value: string }[]
      }, [partners]),
    }),
  ]

  const table = useDataTable({
    columns,
    data: partners ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => navigate(`/partners/${row.id}`),
    rowCount: count,
    isLoading: isPending ?? false,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
  })

  return (
    <>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
            <div>
              <Heading>Partners</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Manage manufacturing and supply partners
              </Text>
            </div>
            <div className="flex items-center justify-center gap-x-2">
              <Button size="small" variant="secondary" asChild>
                <Link to="create">Create</Link>
              </Button>
            </div>
          </DataTable.Toolbar>

          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%] flex items-center gap-x-4">
              <DataTable.FilterMenu tooltip="Filter partners" />
            </div>
            <div className="flex shrink-0 items-center gap-x-2">
              <DataTable.Search placeholder="Search partners..." />
            </div>
          </div>

          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>
      <Outlet />
    </>
  )
}

export default PartnersPage

export const config = defineRouteConfig({
  label: "Partners",
  icon: UserGroup,
})

export const handle = {
  breadcrumb: () => "Partners",
}
