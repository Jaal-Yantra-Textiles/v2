import {
  Container,
  Heading,
  Text,
  DataTable,
  useDataTable,
  createDataTableColumnHelper,
  createDataTableFilterHelper,
  DataTablePaginationState,
  DataTableFilteringState,
  Button,
  Badge,
  usePrompt,
  toast,
} from "@medusajs/ui"
import { Link, Outlet, useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ChatBubbleLeftRight,
  Plus,
  Trash,
  ArchiveBox,
  ChatBubbleLeftRightSolid,
} from "@medusajs/icons"
import { useState, useCallback, useMemo } from "react"
import debounce from "lodash/debounce"
import { ActionMenu } from "../../components/common/action-menu"
import {
  useConversations,
  useArchiveConversation,
  useDeleteConversation,
  type ConversationPreview,
} from "../../hooks/api/messaging"

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "-"
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)
  if (diff < 60) return "now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const columnHelper = createDataTableColumnHelper<ConversationPreview>()
const filterHelper = createDataTableFilterHelper<ConversationPreview>()

const MessagingPage = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 20,
    pageIndex: 0,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")
  const handleSearchChange = useCallback(debounce((q: string) => setSearch(q), 300), [])
  const handleFilterChange = useCallback(
    debounce((f: DataTableFilteringState) => setFiltering(f), 300),
    []
  )

  const archiveMutation = useArchiveConversation()
  const deleteMutation = useDeleteConversation()

  const offset = pagination.pageIndex * pagination.pageSize

  const statusFilter = filtering.status
    ? (Array.isArray(filtering.status) ? filtering.status[0] : filtering.status) as string
    : undefined

  const { conversations = [], count = 0, isPending } = useConversations(
    {
      limit: pagination.pageSize,
      offset,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    { refetchInterval: 10000 }
  )

  const filtered = search
    ? conversations.filter(
        (c) =>
          c.partner_name?.toLowerCase().includes(search.toLowerCase()) ||
          c.phone_number?.includes(search)
      )
    : conversations

  const handleArchive = async (id: string) => {
    const confirmed = await prompt({
      title: "Archive Conversation?",
      description: "This conversation will be moved to the archived tab. You can restore it later.",
      confirmText: "Archive",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await archiveMutation.mutateAsync(id)
      toast.success("Conversation archived")
    } catch (e: any) {
      toast.error(e.message || "Failed to archive conversation")
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await prompt({
      title: "Delete Conversation?",
      description: "This will permanently delete the conversation and all its messages. This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
    })
    if (!confirmed) return
    try {
      await deleteMutation.mutateAsync(id)
      toast.success("Conversation deleted")
    } catch (e: any) {
      toast.error(e.message || "Failed to delete conversation")
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor("partner_name", {
        header: "Partner",
        cell: ({ getValue }) => (
          <Text size="small" weight="plus">{getValue()}</Text>
        ),
        enableSorting: true,
      }),
      columnHelper.accessor("phone_number", {
        header: "Phone",
        cell: ({ getValue }) => (
          <Text size="small" className="font-mono">{getValue()}</Text>
        ),
      }),
      columnHelper.accessor("unread_count", {
        header: "Unread",
        cell: ({ getValue }) => {
          const val = getValue()
          return val > 0 ? (
            <Badge color="green" size="2xsmall">{val}</Badge>
          ) : (
            <Text size="small" className="text-ui-fg-muted">0</Text>
          )
        },
      }),
      columnHelper.accessor("last_message", {
        header: "Last Message",
        cell: ({ getValue }) => {
          const msg = getValue()
          if (!msg) return <Text size="small" className="text-ui-fg-muted">-</Text>
          return (
            <Text size="small" className="text-ui-fg-subtle truncate max-w-[250px]">
              {msg.direction === "outbound" ? "You: " : ""}
              {msg.content}
            </Text>
          )
        },
      }),
      columnHelper.accessor("last_message_at", {
        header: "Time",
        cell: ({ getValue }) => (
          <Text size="small" className="text-ui-fg-muted">{timeAgo(getValue())}</Text>
        ),
        enableSorting: true,
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => (
          <Badge
            color={getValue() === "active" ? "green" : "grey"}
            size="2xsmall"
          >
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    icon: <ChatBubbleLeftRightSolid />,
                    label: "Open Thread",
                    onClick: () => navigate(`/messaging/${row.original.id}`),
                  },
                ],
              },
              {
                actions: [
                  {
                    icon: <ArchiveBox />,
                    label: "Archive",
                    onClick: () => handleArchive(row.original.id),
                  },
                  {
                    icon: <Trash />,
                    label: "Delete",
                    onClick: () => handleDelete(row.original.id),
                  },
                ],
              },
            ]}
          />
        ),
      }),
    ],
    []
  )

  const filters = useMemo(
    () => [
      filterHelper.accessor("status", {
        type: "select",
        label: "Status",
        options: [
          { label: "Active", value: "active" },
          { label: "Archived", value: "archived" },
        ],
      }),
    ],
    []
  )

  const table = useDataTable({
    columns,
    data: filtered,
    getRowId: (row) => row.id,
    onRowClick: (_, row) => navigate(`/messaging/${row.id}`),
    rowCount: count,
    isLoading: isPending,
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
              <Heading>WhatsApp Messages</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Conversations with your suppliers
              </Text>
            </div>
            <div className="flex items-center gap-x-2">
              <Button size="small" variant="secondary" asChild>
                <Link to="create">
                  <Plus />
                  New Message
                </Link>
              </Button>
            </div>
          </DataTable.Toolbar>

          <div className="flex items-start justify-between gap-x-4 px-6 py-4 border-t border-ui-border-base">
            <div className="w-full max-w-[60%] flex items-center gap-x-4">
              <DataTable.FilterMenu tooltip="Filter conversations" />
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

export const config = defineRouteConfig({
  label: "Messages",
  icon: ChatBubbleLeftRight,
})

export default MessagingPage

export const handle = {
  breadcrumb: () => "Messages",
}
