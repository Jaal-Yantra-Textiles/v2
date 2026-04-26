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
import { usePartnerColumns } from "../send-to-partner/hooks/use-partner-columns"
import { useLinkDesignToPartner } from "../../../hooks/api/designs"

interface LinkDesignPartnerFormProps {
  designId: string
}

const filterHelper = createDataTableFilterHelper<AdminPartner>()

export const LinkDesignPartnerForm = ({ designId }: LinkDesignPartnerFormProps) => {
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})

  const { mutate: linkPartners, isPending: isLinking } = useLinkDesignToPartner(designId)

  const queryParams = useMemo(() => {
    const params: any = {
      offset: pagination.pageIndex * pagination.pageSize,
      limit: pagination.pageSize,
    }
    
    if (search) {
      params.q = search
    }
    
    Object.entries(filtering).forEach(([key, value]) => {
      if (value) {
        params[key] = value
      }
    })
    
    return params
  }, [pagination, search, filtering])

  const { partners, isLoading: partnersLoading } = usePartners(queryParams)

  const isLoading = partnersLoading || isLinking

  const filteredItems = partners || []

  const handleRowSelect = useCallback((id: string) => {
    setSelectedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }, [])

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

  const paginatedItems = filteredItems

  const columns = usePartnerColumns(selectedRows, handleRowSelect)

  const table = useDataTable({
    columns: columns,
    data: paginatedItems,
    getRowId: (row) => row.id,
    rowCount: partners?.length || 0,
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

  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0
    setIsCommandBarOpen(hasSelections)
  }, [selectedRows])

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        event.preventDefault()
      }
    }

    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey)
    }

    return () => {
      if (isCommandBarOpen) {
        window.removeEventListener('keydown', handleEscapeKey)
      }
    }
  }, [isCommandBarOpen])

  const selectedPartnerIds = Object.keys(selectedRows).filter(id => selectedRows[id])
  const selectedCount = selectedPartnerIds.length

  const handleLink = useCallback(async () => {
    if (selectedCount === 0) {
      toast.error("Please select at least one partner")
      return
    }

    linkPartners({ partnerIds: selectedPartnerIds }, {
        onSuccess: () => {
            toast.success(`Successfully linked to ${selectedCount} partner${selectedCount > 1 ? 's' : ''}`)
            setSelectedRows({})
        },
        onError: (error) => {
            toast.error(error.message || "Failed to link to partners")
        }
    })
  }, [selectedPartnerIds, selectedCount, linkPartners])

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header></RouteFocusModal.Header>
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Command
            action={handleLink}
            label="Link"
            shortcut="l"
          />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Link to Partner</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Select partners to link to this design
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
