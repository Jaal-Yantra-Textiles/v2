import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ListBullet, PencilSquare } from "@medusajs/icons"
import CreateButton from "../../../components/creates/create-button"
import { useMemo, useState, useCallback } from "react"
import { EntityActions } from "../../../components/persons/personsActions"
import { createColumnHelper } from "@tanstack/react-table"
import { useForms, AdminForm } from "../../../hooks/api/forms"
import { useFormsTableColumns } from "../../../hooks/columns/useFormsTableColumns"
import { useNavigate } from "react-router-dom"
import debounce from "lodash/debounce"
import { TableSkeleton } from "../../../components/table/skeleton"

const columnHelper = createColumnHelper<AdminForm>()

export const useColumns = () => {
  const columns = useFormsTableColumns()

  const formActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (form: AdminForm) => `/settings/forms/${form.id}/edit`,
      },
    ],
  }

  return useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions entity={row.original} actionsConfig={formActionsConfig} />
        ),
      }),
    ],
    [columns]
  )
}

const PAGE_SIZE = 20

const FormsPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState<string>("")

  const offset = pagination.pageIndex * pagination.pageSize

  const { forms, count, isLoading } = useForms(
    {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
      ...(Object.keys(filtering).length > 0
        ? Object.entries(filtering).reduce((acc, [key, value]) => {
            acc[key] = value as string
            return acc
          }, {} as any)
        : {}),
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  const columns = useColumns()

  const filterHelper = createDataTableFilterHelper<AdminForm>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
        { label: "Archived", value: "archived" },
      ],
    }),
    filterHelper.accessor("domain", {
      type: "select",
      label: "Domain",
      options: [],
    }),
  ]

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters)
    }, 300),
    []
  )

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch)
    }, 300),
    []
  )

  const table = useDataTable({
    columns,
    data: forms ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/settings/forms/${row.id}`)
    },
    rowCount: count,
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

  if (isLoading) {
    return (
      <TableSkeleton
        layout="fill"
        rowCount={10}
        search={true}
        filters={true}
        orderBy={true}
        pagination={true}
      />
    )
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Forms</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage website forms and view responses
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search forms..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter forms" />
              <CreateButton />
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export default FormsPage

export const config = defineRouteConfig({
  label: "Forms",
  icon: ListBullet,
})

export const handle = {
  breadcrumb: () => "Forms",
}
