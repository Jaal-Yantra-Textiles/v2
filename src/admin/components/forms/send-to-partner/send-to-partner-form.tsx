import { 
  Heading, 
  Text, 
  DataTable, 
  useDataTable, 
  createDataTableFilterHelper, 
  DataTablePaginationState, 
  DataTableFilteringState, 
  CommandBar, 
  toast
} from "@medusajs/ui"
import { useState, useMemo, useCallback, useEffect } from "react"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { AdminPartner, usePartners } from "../../../hooks/api/partners"
import { usePartnerColumns } from "./hooks/use-partner-columns"
import { useSendInventoryOrderToPartner } from "../../../hooks/api/inventory-orders"
import { useRouteModal } from "../../modal/use-route-modal"

interface SendToPartnerFormProps {
  entityId?: string
  entityType?: string
  onSuccess?: () => void
}

const filterHelper = createDataTableFilterHelper<AdminPartner>()

export const SendToPartnerForm = ({ entityId, entityType, onSuccess }: SendToPartnerFormProps) => {
  const { mutateAsync: sendToPartner } = useSendInventoryOrderToPartner(entityId || "")
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const { handleSuccess } = useRouteModal();
  // Build query parameters for the API
  const queryParams = useMemo(() => {
    const params: any = {
      offset: pagination.pageIndex * pagination.pageSize,
      limit: pagination.pageSize,
    }
    
    if (search) {
      params.q = search
    }
    
    // Apply filters
    Object.entries(filtering).forEach(([key, value]) => {
      if (value) {
        params[key] = value
      }
    })
    
    return params
  }, [pagination, search, filtering])

  const { partners, count, isLoading: partnersLoading } = usePartners(queryParams)


  const isLoading = partnersLoading

  // Use partners directly from API since filtering is now handled server-side
  const filteredItems = partners || []
  const totalCount = count || 0

  const handleRowSelect = useCallback((id: string) => {
    setSelectedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }, [])

  // Create filters
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
        { label: "Verified", value: "true" },
        { label: "Not Verified", value: "false" },
      ],
    }),
  ]

  // Use filtered items directly since pagination is handled server-side
  const paginatedItems = filteredItems

  // Create columns
  const columns = usePartnerColumns(selectedRows, handleRowSelect)

  // Create table
  const table = useDataTable({
    columns: columns,
    data: paginatedItems,
    getRowId: (row) => row.id,
    rowCount: totalCount,
    onRowClick: (_, row) => {
      const rowId = row.id
      handleRowSelect(rowId)
    },
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  })

  // Update command bar visibility when selections change
  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0
    setIsCommandBarOpen(hasSelections)
  }, [selectedRows])

  // Add escape key handler to clear selections
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        // Prevent default behavior to avoid conflicts with other handlers
        event.preventDefault()
      }
    }

    // Add the event listener when the command bar is open
    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey)
    }

    // Cleanup function to remove the event listener
    return () => {
      if (isCommandBarOpen) {
        window.removeEventListener('keydown', handleEscapeKey)
      }
    }
  }, [isCommandBarOpen])

  // Only count selected partners that are actually valid (exist in current data or were previously loaded)
  const selectedPartnerIds = Object.keys(selectedRows).filter(id => selectedRows[id])
  const selectedCount = selectedPartnerIds.length

  const handleSend = useCallback(async () => {
    if (selectedPartnerIds.length === 0) {
      toast.error("Please select at least one partner")
      return
    }

    if (!entityId) {
      toast.error("Entity ID is missing")
      return
    }

    try {
      // Send to each selected partner
      for (const partnerId of selectedPartnerIds) {
        await sendToPartner({ partnerId })
      }
      toast.success(`Successfully sent to ${selectedCount} partner${selectedCount > 1 ? 's' : ''}`)
      setSelectedRows({})
      handleSuccess()
    } catch (error: any) {
      toast.error(error?.message || "Failed to send to partners")
    }
  }, [selectedPartnerIds, selectedCount, entityId, sendToPartner, onSuccess])

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header></RouteFocusModal.Header>
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Command
            action={handleSend}
            label="Send"
            shortcut="s"
          />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Send to Partner</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Select partners to send {entityType || "item"} to
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter partners" />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </RouteFocusModal>
  )
}
