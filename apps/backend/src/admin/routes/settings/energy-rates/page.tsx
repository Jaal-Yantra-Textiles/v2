import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  Badge,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import { useMemo, useState, useCallback } from "react"
import { createColumnHelper } from "@tanstack/react-table"
import { Link, useNavigate } from "react-router-dom"
import debounce from "lodash/debounce"

import {
  AdminEnergyRate,
  useEnergyRates,
} from "../../../hooks/api/energy-rates"

const ENERGY_TYPE_LABELS: Record<string, string> = {
  energy_electricity: "Electricity",
  energy_water: "Water",
  energy_gas: "Gas",
  labor: "Labor",
}

const UOM_LABELS: Record<string, string> = {
  kWh: "kWh",
  Liter: "Liter",
  Cubic_Meter: "m\u00B3",
  Hour: "Hour",
  Other: "Other",
}

const columnHelper = createColumnHelper<AdminEnergyRate>()

const useColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue }) => (
          <Text size="small" weight="plus">{getValue()}</Text>
        ),
      }),
      columnHelper.accessor("energy_type", {
        header: "Type",
        cell: ({ getValue }) => {
          const val = getValue()
          return <Badge color="blue">{ENERGY_TYPE_LABELS[val] || val}</Badge>
        },
      }),
      columnHelper.accessor("rate_per_unit", {
        header: "Rate",
        cell: ({ row }) => {
          const rate = row.original
          return (
            <Text size="small">
              {rate.rate_per_unit} {rate.currency?.toUpperCase()}/{UOM_LABELS[rate.unit_of_measure] || rate.unit_of_measure}
            </Text>
          )
        },
      }),
      columnHelper.accessor("effective_from", {
        header: "Effective From",
        cell: ({ getValue }) => {
          const d = getValue()
          return (
            <Text size="small">
              {d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
            </Text>
          )
        },
      }),
      columnHelper.accessor("effective_to", {
        header: "Effective To",
        cell: ({ getValue }) => {
          const d = getValue()
          return (
            <Text size="small">
              {d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Open-ended"}
            </Text>
          )
        },
      }),
      columnHelper.accessor("region", {
        header: "Region",
        cell: ({ getValue }) => (
          <Text size="small">{getValue() || "All"}</Text>
        ),
      }),
      columnHelper.accessor("is_active", {
        header: "Status",
        cell: ({ getValue }) => (
          <Badge color={getValue() ? "green" : "grey"}>
            {getValue() ? "Active" : "Inactive"}
          </Badge>
        ),
      }),
    ],
    []
  )
}

const EnergyRatesPage = () => {
  const navigate = useNavigate()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const queryParams: Record<string, any> = {
    limit: pagination.pageSize,
    offset,
  }

  // Apply filters
  if (filtering.energy_type) queryParams.energy_type = filtering.energy_type
  if (filtering.is_active !== undefined) queryParams.is_active = filtering.is_active

  const { energy_rates, count, isLoading, isError, error } = useEnergyRates(
    queryParams,
    { placeholderData: keepPreviousData }
  )

  const columns = useColumns()

  const filterHelper = createDataTableFilterHelper<AdminEnergyRate>()
  const filters = [
    filterHelper.accessor("energy_type", {
      type: "select",
      label: "Type",
      options: [
        { label: "Electricity", value: "energy_electricity" },
        { label: "Water", value: "energy_water" },
        { label: "Gas", value: "energy_gas" },
        { label: "Labor", value: "labor" },
      ],
    }),
    filterHelper.accessor("is_active", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "true" },
        { label: "Inactive", value: "false" },
      ],
    }),
  ]

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters)
    }, 300),
    []
  )

  const table = useDataTable({
    columns,
    data: energy_rates ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) => {
      navigate(`/settings/energy-rates/${row.id}`)
    },
    rowCount: count ?? 0,
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
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
            <Heading>Energy Rates</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Configure energy and labor cost rates for production run cost estimation
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.FilterMenu tooltip="Filter rates" />
            <Link to="create">
              <button className="shadow-borders-base bg-ui-button-neutral text-ui-fg-base hover:bg-ui-button-neutral-hover rounded-md px-3 py-1.5 text-sm font-medium">
                Add Rate
              </button>
            </Link>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}

export default EnergyRatesPage

export const config = defineRouteConfig({
  label: "Energy Rates",
  icon: CurrencyDollar,
})

export const handle = {
  breadcrumb: () => "Energy Rates",
}
