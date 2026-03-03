import {
  Badge,
  Button,
  Container,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Text,
  Toaster,
  createDataTableFilterHelper,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { EnvelopeSolid } from "@medusajs/icons"
import { createColumnHelper } from "@tanstack/react-table"
import debounce from "lodash/debounce"
import { useCallback, useMemo, useState } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import {
  AdminInboundEmail,
  useInboundEmails,
  useSyncInboundEmails,
} from "../../../hooks/api/inbound-emails"

const columnHelper = createColumnHelper<AdminInboundEmail>()
const PAGE_SIZE = 20

const STATUS_COLORS: Record<string, "green" | "orange" | "blue" | "grey"> = {
  received: "blue",
  action_pending: "orange",
  processed: "green",
  ignored: "grey",
}

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  action_pending: "Action Pending",
  processed: "Processed",
  ignored: "Ignored",
}

type FilteringUpdater =
  | DataTableFilteringState
  | ((prev: DataTableFilteringState) => DataTableFilteringState)

const InboundEmailsPage = () => {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize
  const selectedStatus = (filtering?.status as string) || ""

  const { inbound_emails, count, isLoading } = useInboundEmails(
    {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
      status: selectedStatus || undefined,
    },
    { placeholderData: keepPreviousData }
  )

  const { mutate: syncEmails, isPending: isSyncing } = useSyncInboundEmails({
    onSuccess: (data) => {
      const providerLabel = data.providers_synced === 1 ? "1 provider" : `${data.providers_synced} providers`
      toast.success(`Synced ${data.synced} new emails from ${providerLabel} (${data.skipped} already existed)`)
      if (data.errors?.length) {
        data.errors.forEach((e) => toast.error(e))
      }
    },
    onError: (err) => {
      toast.error(err.message || "Sync failed")
    },
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor("from_address", {
        header: "From",
        cell: ({ getValue }) => (
          <span className="font-mono text-sm">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("subject", {
        header: "Subject",
        cell: ({ getValue }) => (
          <span className="max-w-[300px] truncate block">{getValue()}</span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue()
          return (
            <Badge color={STATUS_COLORS[status] || "grey"} size="2xsmall">
              {STATUS_LABELS[status] ?? status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor("folder", {
        header: "Source",
        cell: ({ getValue }) => {
          const folder = getValue()
          if (folder === "resend_inbound") {
            return <Badge color="purple" size="2xsmall">Resend</Badge>
          }
          return <span className="text-sm text-ui-fg-subtle">{folder}</span>
        },
      }),
      columnHelper.accessor("action_type", {
        header: "Action",
        cell: ({ getValue }) => {
          const v = getValue()
          return v
            ? <span className="text-sm">{v.replace(/_/g, " ")}</span>
            : <span className="text-ui-fg-muted text-sm">—</span>
        },
      }),
      columnHelper.accessor("received_at", {
        header: "Received",
        cell: ({ getValue }) => {
          const date = new Date(getValue())
          return (
            <span className="text-sm text-ui-fg-subtle">
              {date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )
        },
      }),
    ],
    []
  )

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    }, 300),
    []
  )

  const handleFilteringChange = useCallback((updater: FilteringUpdater) => {
    setFiltering((prev) =>
      typeof updater === "function" ? updater(prev) : updater
    )
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const filterHelper = createDataTableFilterHelper<AdminInboundEmail>()
  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "All", value: "" },
        { label: "Received", value: "received" },
        { label: "Action Pending", value: "action_pending" },
        { label: "Processed", value: "processed" },
        { label: "Ignored", value: "ignored" },
      ],
    }),
  ]

  const table = useDataTable({
    columns,
    data: inbound_emails ?? [],
    getRowId: (row) => row.id,
    onRowClick: (_, row) => {
      navigate(`/settings/inbound-emails/${row.id}`)
    },
    rowCount: count ?? 0,
    isLoading,
    filters,
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilteringChange,
    },
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
  })

  return (
    <>
      <Toaster />

      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Inbound Emails</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Emails received via IMAP and Resend for processing.
              </Text>
            </div>
            <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search emails..." />
              </div>
              <div className="flex items-center gap-x-2">
                <DataTable.FilterMenu tooltip="Filter emails" />
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => syncEmails({ count: 50 })}
                  isLoading={isSyncing}
                >
                  Sync Now
                </Button>
              </div>
            </div>
          </DataTable.Toolbar>
          <DataTable.Table />
          <DataTable.Pagination />
        </DataTable>
      </Container>

      <Outlet />
    </>
  )
}

export default InboundEmailsPage

export const config = defineRouteConfig({
  label: "Inbound Emails",
  icon: EnvelopeSolid,
})

export const handle = {
  breadcrumb: () => "Inbound Emails",
}
