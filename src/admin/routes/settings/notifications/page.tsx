import {
  Container,
  DataTable,
  DataTablePaginationState,
  DataTableFilteringState,
  Heading,
  Text,
  useDataTable,
  createDataTableFilterHelper,
  toast,
  Toaster,
} from "@medusajs/ui"
import { keepPreviousData } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ListBullet } from "@medusajs/icons"
import { createColumnHelper } from "@tanstack/react-table"
import debounce from "lodash/debounce"
import { useCallback, useMemo, useState } from "react"

import { EntityActions } from "../../../components/persons/personsActions"
import { TableSkeleton } from "../../../components/table/skeleton"
import {
  Notification,
  useNotifications,
  useRetryFailedEmail,
} from "../../../hooks/api/notifications"
import { useFailedNotificationsTableColumns } from "../../../hooks/columns/useFailedNotificationsTableColumns"

const columnHelper = createColumnHelper<Notification>()

const PAGE_SIZE = 20

type FilteringUpdater =
  | DataTableFilteringState
  | ((prev: DataTableFilteringState) => DataTableFilteringState)

const ListAllNotificiation = () => {
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: PAGE_SIZE,
    pageIndex: 0,
  })
  const [search, setSearch] = useState<string>("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const selectedChannel = (filtering?.channel as string) || ""
  const selectedStatus = (filtering?.status as string) || ""

  const { failed_emails, total, isLoading } = useNotifications(
    {
      limit: pagination.pageSize,
      offset,
      q: search || undefined,
      channel: selectedChannel || undefined,
      status: selectedStatus || undefined,
    },
    {
      placeholderData: keepPreviousData,
    }
  )

  const columns = useFailedNotificationsTableColumns()

  const { mutate, isPending } = useRetryFailedEmail()

  const handleRetry = useCallback(
    (notification: Notification) => {
      mutate({
        notificationId: notification.id,
        to: notification.to,
        template: notification.template,
        data: notification.data,
      })
    },
    [mutate]
  )

  const canRetry = useCallback((n: Notification) => {
    return n.channel === "email" && n.status === "failure"
  }, [])

  const notificationActionsConfig = useMemo(
    () => ({
      actions: [
        {
          icon: <ArrowPath />,
          label: "Retry",
          disabled: isPending,
          onClick: (n: Notification) => {
            if (!canRetry(n)) {
              toast.info("Only email notifications that have failed can be retried")
              return
            }
            handleRetry(n)
          },
        },
      ],
    }),
    [canRetry, handleRetry, isPending]
  )

  const tableColumns = useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions entity={row.original} actionsConfig={notificationActionsConfig} />
        ),
      }),
    ],
    [columns, notificationActionsConfig]
  )

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    }, 300),
    []
  )

  const handleFilteringChange = useCallback((updater: FilteringUpdater) => {
    setFiltering((prev) => (typeof updater === "function" ? updater(prev) : updater))
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [])

  const filterHelper = createDataTableFilterHelper<Notification>()
  const filters = [
    filterHelper.accessor("channel", {
      type: "select",
      label: "Channel",
      options: [
        { label: "All", value: "" },
        { label: "Email", value: "email" },
        { label: "Feed", value: "feed" },
        { label: "Slack", value: "slack" },
      ],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "All", value: "" },
        { label: "Failure", value: "failure" },
        { label: "Pending", value: "pending" },
        { label: "Success", value: "success" },
      ],
    }),
  ]

  const table = useDataTable({
    columns: tableColumns,
    data: failed_emails ?? [],
    getRowId: (row) => row.id as string,
    rowCount: total,
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

  if (isLoading) {
    return (
      <TableSkeleton
        layout="fill"
        rowCount={10}
        search={true}
        filters={false}
        orderBy={true}
        pagination={true}
      />
    )
  }

  return (
    <>
    <Toaster/>
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Notifications</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Browse and filter notifications.
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search notifications..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter notifications" />
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
    </>
  )
}

export default ListAllNotificiation

export const config = defineRouteConfig({
  label: "Notifications",
  icon: ListBullet,
})

export const handle = {
  breadcrumb: () => "Notifications",
}
