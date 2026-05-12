import {
  Container,
  DataTable,
  type DataTablePaginationState,
  Heading,
  StatusBadge,
  Text,
  useDataTable,
} from "@medusajs/ui"
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { type AdsAccount, type AdsPlatformKind, useAdsAccounts } from "../../../hooks/api/ads"
import { formatNumber, shortDate, statusToTone } from "./format"

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<AdsAccount>()

type Props = { platformId: string; kind: AdsPlatformKind | null }

export const AccountsTab = ({ platformId, kind }: Props) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const pageFromUrl = parseInt(searchParams.get("acc_page") || "1", 10)
  const limitFromUrl = parseInt(
    searchParams.get("acc_limit") || String(PAGE_SIZE),
    10
  )
  const pagination: DataTablePaginationState = {
    pageIndex: Math.max(0, pageFromUrl - 1),
    pageSize: limitFromUrl,
  }
  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useAdsAccounts({
    platform_id: platformId,
    limit: pagination.pageSize,
    offset,
  })

  const handlePaginationChange = useCallback(
    (newPagination: DataTablePaginationState) => {
      const params = new URLSearchParams(searchParams)
      if (newPagination.pageIndex > 0)
        params.set("acc_page", String(newPagination.pageIndex + 1))
      else params.delete("acc_page")
      if (newPagination.pageSize !== PAGE_SIZE)
        params.set("acc_limit", String(newPagination.pageSize))
      else params.delete("acc_limit")
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => (
        <span className="font-medium">{info.getValue() || "—"}</span>
      ),
    }),
    columnHelper.accessor("provider_account_id", {
      header: kind === "google" ? "Customer ID" : "Account ID",
      cell: (info) => (
        <Text size="small" className="font-mono text-ui-fg-subtle">
          {info.getValue()}
        </Text>
      ),
    }),
    columnHelper.accessor("currency", {
      header: "Currency",
      cell: (info) => info.getValue() || "—",
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => (
        <StatusBadge color={statusToTone(info.getValue())}>
          {info.getValue() || "—"}
        </StatusBadge>
      ),
    }),
    columnHelper.accessor("raw.amount_spent", {
      header: "Spent",
      cell: (info) => {
        // Meta-only — Google has no flat lifetime spend column at account
        // level (use insights instead). Cleanly show — for Google rows.
        const v = info.getValue()
        if (v === undefined || v === null) return "—"
        return formatNumber(Number(v) || 0)
      },
    }),
    columnHelper.accessor("last_synced_at", {
      header: "Last synced",
      cell: (info) => shortDate(info.getValue()),
    }),
  ]

  const table = useDataTable({
    data: data?.accounts || [],
    columns,
    rowCount: data?.count || 0,
    getRowId: (row) => row.id,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: handlePaginationChange,
    },
  })

  if (isError) throw error

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 w-full px-6 py-4">
          <div>
            <Heading>Accounts</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              {kind === "google"
                ? "Google Ads customers (CIDs) synced from this platform."
                : "Meta ad accounts synced from this platform."}
            </Text>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  )
}
