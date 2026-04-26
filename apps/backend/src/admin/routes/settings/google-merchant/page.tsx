import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingCart } from "@medusajs/icons"
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
import debounce from "lodash/debounce"
import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { GoogleMerchantAccount, useGoogleMerchantAccounts } from "../../../hooks/api/google-merchant"
import { useGoogleMerchantAccountColumns } from "./hooks/use-google-merchant-account-columns"

const PAGE_SIZE = 20

const filterHelper = createDataTableFilterHelper<GoogleMerchantAccount>()

const GoogleMerchantPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [sorting, setSorting] = useState<{ id: string; desc: boolean } | null>(null)

  const offset = pagination.pageIndex * pagination.pageSize
  const orderParam = sorting?.id ? `${sorting.id}:${sorting.desc ? "DESC" : "ASC"}` : undefined

  const connectedFilter = filtering.connected as string | string[] | undefined
  const connectedValue = Array.isArray(connectedFilter) ? connectedFilter[0] : connectedFilter

  const { accounts, count, isLoading, isError, error } = useGoogleMerchantAccounts({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    ...(orderParam ? { order: orderParam } : {}),
    ...(connectedValue === "true" || connectedValue === "false"
      ? { connected: connectedValue as "true" | "false" }
      : {}),
  })

  const columns = useGoogleMerchantAccountColumns()

  const filters = useMemo(
    () => [
      filterHelper.accessor("connected" as any, {
        type: "select",
        label: "Status",
        options: [
          { label: "Connected", value: "true" },
          { label: "Not connected", value: "false" },
        ],
      }),
    ],
    []
  )

  const handleSearchChange = useCallback(
    debounce((value: string) => setSearch(value), 300),
    []
  )

  const handleFilterChange = useCallback(
    debounce((value: DataTableFilteringState) => setFiltering(value), 300),
    []
  )

  const table = useDataTable({
    data: accounts,
    columns,
    rowCount: count ?? 0,
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/settings/google-merchant/${row.id}`),
    isLoading,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
    sorting: { state: sorting, onSortingChange: setSorting },
  })

  if (isError) throw error

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Google Merchant Center</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Connect and manage Google Merchant Center accounts for product syncing
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search by name, merchant ID, email…" />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter accounts" />
              <Button
                size="small"
                variant="secondary"
                onClick={() => navigate("/settings/external-platforms")}
              >
                Back
              </Button>
              <Button
                size="small"
                variant="primary"
                onClick={() => navigate("/settings/google-merchant/create")}
              >
                Add Account
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
  label: "Google Merchant",
  icon: ShoppingCart,
})

export const handle = {
  breadcrumb: () => "Google Merchant",
}

export default GoogleMerchantPage
