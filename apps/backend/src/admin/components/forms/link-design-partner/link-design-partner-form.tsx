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
import { useModalChrome } from "../../modal/chrome/use-modal-chrome"
import { AdminPartner, usePartners } from "../../../hooks/api/partners"
import { usePartnerColumns } from "../send-to-partner/hooks/use-partner-columns"
import { DesignPartnerStageRole, useLinkDesignToPartner } from "../../../hooks/api/designs"
import { StageRoleSelect } from "../../designs/stage-role-select"

interface LinkDesignPartnerFormProps {
  designId: string
}

const filterHelper = createDataTableFilterHelper<AdminPartner>()

/**
 * 🔴 This component no longer renders its own modal ROOT.
 *
 * It used to open a `RouteFocusModal` itself, which made it unusable anywhere
 * but its own route: rendered inside another modal it would have stacked a
 * second focus modal over the first. The shell now owns the root — the
 * `@linkPartner` route, or the design graph's stacked modal — and this form
 * only fills in the chrome that shell publishes.
 */
export const LinkDesignPartnerForm = ({ designId }: LinkDesignPartnerFormProps) => {
  const Chrome = useModalChrome()
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [search, setSearch] = useState("")
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  // The stage every selected partner joins with (#2306); null = none yet.
  const [stageRole, setStageRole] = useState<DesignPartnerStageRole | null>(null)

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

    // A stage is only sent when one is picked: an omitted stage leaves an
    // already-linked partner's stage alone instead of clearing it.
    const partners = selectedPartnerIds.map((partner_id) =>
      stageRole ? { partner_id, stage_role: stageRole } : { partner_id }
    )
    linkPartners({ partners }, {
        onSuccess: () => {
            toast.success(`Successfully linked to ${selectedCount} partner${selectedCount > 1 ? 's' : ''}`)
            setSelectedRows({})
        },
        onError: (error) => {
            toast.error(error.message || "Failed to link to partners")
        }
    })
  }, [selectedPartnerIds, selectedCount, linkPartners, stageRole])

  return (
    <>
      <Chrome.Header>
        <Chrome.Title asChild>
          <span className="sr-only">Link partners to this design</span>
        </Chrome.Title>
      </Chrome.Header>
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
              Select partners and the stage they do. Linking does not message them.
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <div className="w-48">
              <StageRoleSelect value={stageRole} onChange={setStageRole} />
            </div>
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter partners" />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </>
  )
}
