import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  Button,
} from "@medusajs/ui"
import { Link, useNavigate } from "react-router-dom"
import { useMemo, useState, useCallback } from "react"
import debounce from "lodash/debounce"
import { usePaymentReports } from "../../../hooks/api/payment-reports"
import type { AdminPaymentReport } from "../../../hooks/api/payment-reports"
import { usePaymentReportTableColumns } from "../../../hooks/columns/usePaymentReportTableColumns"

const useColumns = () => {
  const columns = usePaymentReportTableColumns()
  return useMemo(() => [...columns], [columns])
}

export const SavedReportsTab = () => {
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

  const entityTypeFilter = filtering["entity_type"]
    ? (Array.isArray(filtering["entity_type"])
        ? filtering["entity_type"][0]
        : filtering["entity_type"])
    : undefined

  const { payment_reports = [], count = 0, isPending } = usePaymentReports({
    limit: pagination.pageSize,
    offset,
    entity_type: entityTypeFilter as any,
  }) as any

  const columns = useColumns()
  const filterHelper = createDataTableFilterHelper<AdminPaymentReport>()

  const filters = [
    filterHelper.accessor("entity_type", {
      type: "select",
      label: "Entity Type",
      options: [
        { label: "All", value: "all" },
        { label: "Partner", value: "partner" },
        { label: "Person", value: "person" },
      ],
    }),
  ]

  const table = useDataTable({
    columns,
    data: payment_reports ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => navigate(`/payment-reports/${row.id}`),
    rowCount: count,
    isLoading: isPending ?? false,
    filters,
    pagination: { state: pagination, onPaginationChange: setPagination },
    search: { state: search, onSearchChange: handleSearchChange },
    filtering: { state: filtering, onFilteringChange: handleFilterChange },
  })

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
          <div>
            <Heading>Saved Reports</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Persisted payment report snapshots
            </Text>
          </div>
          <Button size="small" variant="secondary" asChild>
            <Link to="create">Generate Report</Link>
          </Button>
        </DataTable.Toolbar>
        <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
          <div className="w-full max-w-[60%] flex items-center gap-x-4">
            <DataTable.FilterMenu tooltip="Filter reports" />
          </div>
          <div className="flex shrink-0 items-center gap-x-2">
            <DataTable.Search placeholder="Search reports..." />
          </div>
        </div>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
