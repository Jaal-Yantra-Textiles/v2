import { defineRouteConfig } from "@medusajs/admin-sdk"
import { 
  Container, 
  Heading, 
  Button, 
  StatusBadge,
  Text,
  DataTable,
  DataTablePaginationState,
  DataTableFilteringState,
  useDataTable,
  createDataTableFilterHelper,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { 
  ArrowPath,
} from "@medusajs/icons"
import { useNavigate, Outlet } from "react-router-dom"
import { 
  useVisualFlows, 
  useDeleteVisualFlow, 
  useDuplicateVisualFlow,
  VisualFlow,
} from "../../hooks/api/visual-flows"
import { createColumnHelper } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"
import debounce from "lodash/debounce"
import { ActionMenu } from "../../components/common/action-menu"
import { PencilSquare, Trash, SquareTwoStack, PlaySolid } from "@medusajs/icons"

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<VisualFlow>()

const getStatusBadgeColor = (status: string): "green" | "orange" | "grey" => {
  switch (status) {
    case "active":
      return "green"
    case "inactive":
      return "grey"
    case "draft":
      return "orange"
    default:
      return "grey"
  }
}

const getTriggerLabel = (triggerType: string): string => {
  const labels: Record<string, string> = {
    event: "Event",
    schedule: "Schedule",
    webhook: "Webhook",
    manual: "Manual",
    another_flow: "Flow",
  }
  return labels[triggerType] || triggerType
}

const VisualFlowsPage = () => {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const offset = pagination.pageIndex * pagination.pageSize

  const { data, isLoading, isError, error } = useVisualFlows({
    limit: pagination.pageSize,
    offset,
    q: search || undefined,
    ...(filtering.status ? { status: filtering.status as any } : {}),
  })

  console.log(data)
  const deleteFlow = useDeleteVisualFlow()
  const duplicateFlow = useDuplicateVisualFlow()

  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    }, 300),
    []
  )

  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    }, 300),
    []
  )

  const handleDelete = async (flow: VisualFlow) => {
    const confirmed = await prompt({
      title: "Delete Flow",
      description: `Are you sure you want to delete "${flow.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
    })

    if (confirmed) {
      deleteFlow.mutate(flow.id, {
        onSuccess: () => {
          toast.success("Flow deleted successfully")
        },
        onError: (err) => {
          toast.error(`Failed to delete flow: ${err.message}`)
        },
      })
    }
  }

  const handleDuplicate = async (flow: VisualFlow) => {
    duplicateFlow.mutate(
      { id: flow.id },
      {
        onSuccess: (newFlow) => {
          toast.success("Flow duplicated successfully")
          navigate(`/visual-flows/${newFlow.id}`)
        },
        onError: (err) => {
          toast.error(`Failed to duplicate flow: ${err.message}`)
        },
      }
    )
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ getValue, row }) => {
          const name = getValue()
          const description = row.original.description
          return (
            <div>
              <span className="font-medium">{name}</span>
              {description && (
                <Text size="small" className="text-ui-fg-subtle">
                  {description.length > 50 ? description.slice(0, 50) + "..." : description}
                </Text>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue()
          return (
            <StatusBadge color={getStatusBadgeColor(status)}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </StatusBadge>
          )
        },
      }),
      columnHelper.accessor("trigger_type", {
        header: "Trigger",
        cell: ({ getValue }) => getTriggerLabel(getValue()),
      }),
      columnHelper.accessor("operations", {
        header: "Operations",
        cell: ({ getValue }) => `${getValue()?.length || 0} operations`,
      }),
      columnHelper.accessor("created_at", {
        header: "Created",
        cell: ({ getValue }) => new Date(getValue()).toLocaleDateString(),
      }),
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => {
          const flow = row.original
          return (
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      label: "Edit",
                      icon: <PencilSquare />,
                      to: `/visual-flows/${flow.id}`,
                    },
                    {
                      label: "Execute",
                      icon: <PlaySolid />,
                      to: `/visual-flows/${flow.id}/execute`,
                    },
                    {
                      label: "Duplicate",
                      icon: <SquareTwoStack />,
                      onClick: () => handleDuplicate(flow),
                    },
                  ],
                },
                {
                  actions: [
                    {
                      label: "Delete",
                      icon: <Trash />,
                      onClick: () => handleDelete(flow),
                    },
                  ],
                },
              ]}
            />
          )
        },
      }),
    ],
    [handleDelete, handleDuplicate]
  )

  const filterHelper = createDataTableFilterHelper<VisualFlow>()

  const filters = [
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
        { label: "Draft", value: "draft" },
      ],
    }),
    filterHelper.accessor("trigger_type", {
      type: "select",
      label: "Trigger Type",
      options: [
        { label: "Manual", value: "manual" },
        { label: "Webhook", value: "webhook" },
        { label: "Event", value: "event" },
        { label: "Schedule", value: "schedule" },
        { label: "Another Flow", value: "another_flow" },
      ],
    }),
  ]

  const table = useDataTable({
    data: (data?.flows || []) as VisualFlow[],
    columns,
    rowCount: data?.count || 0,
    filters,
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
    getRowId: (row: VisualFlow) => row.id,
    onRowClick: (_, row) => {
      navigate(`/visual-flows/${row.id}`)
    },
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
  })

  if (isError) {
    throw error
  }

  return (
    <div>
      <Container className="divide-y p-0">
        <DataTable instance={table}>
          <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
            <div>
              <Heading>Visual Flows</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Create and manage automated workflows with a visual editor
              </Text>
            </div>
            <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
              <div className="w-full sm:max-w-[260px] md:w-auto">
                <DataTable.Search placeholder="Search flows..." />
              </div>
              <div className="flex items-center gap-x-2">
                <DataTable.FilterMenu tooltip="Filter flows" />
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => navigate("create")}
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
      <Outlet />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Visual Flows",
  icon: ArrowPath,
})

export const handle = {
  breadcrumb: () => "Visual Flows",
}

export default VisualFlowsPage
