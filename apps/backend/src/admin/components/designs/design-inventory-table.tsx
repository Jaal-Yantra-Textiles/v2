import {
  CommandBar,
  DataTable,
  DataTableFilteringState,
  DataTablePaginationState,
  Heading,
  Text,
  createDataTableFilterHelper,
  toast,
  useDataTable,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { RouteFocusModal } from "../modal/route-focus-modal"
import { InventoryItem, useInventoryWithRawMaterials } from "../../hooks/api/raw-materials"
import { useDesignInventory, useLinkDesignInventory } from "../../hooks/api/designs"
import { useInventoryColumns } from "./hooks/use-inventory-columns"

interface DesignInventoryTableProps {
  designId: string
}

interface SelectedRowConfig {
  inventoryId: string
  title?: string
  sku?: string
}

const getRowId = (row: InventoryItem) => String(row.inventory_item_id || row.id)

const createSelectionConfig = (item: InventoryItem): SelectedRowConfig => {
  const rowId = getRowId(item)
  return {
    inventoryId: rowId,
    title: item.inventory_item?.title || item.title,
    sku: item.inventory_item?.sku || item.sku,
  }
}

export function DesignInventoryTable({ designId }: DesignInventoryTableProps) {
  const [selectedRows, setSelectedRows] = useState<Record<string, SelectedRowConfig>>({})
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false)
  const prevSelectedCount = useRef(0)
  const navigate = useNavigate()

  const linkInventory = useLinkDesignInventory(designId)
  const { data: linkedInventory, isLoading: isLoadingLinked } = useDesignInventory(designId)
  const { inventory_items = [], isLoading: isLoadingItems } = useInventoryWithRawMaterials({
    fields: "+raw_materials.*, +raw_materials.material_type.*, +location_levels.*, +location_levels.stock_locations.*",
    limit: 100,
  })

  const linkedItemIds = useMemo(() => {
    if (!linkedInventory?.inventory_items || !Array.isArray(linkedInventory.inventory_items)) {
      return new Set<string>()
    }

    const linkedIds = linkedInventory.inventory_items
      .map((link) => {
        if (typeof link === "string") {
          return link
        }
        if (link && typeof link === "object") {
          return link.inventory_item_id || link.inventory_id
        }
        return undefined
      })
      .filter(Boolean) as string[]

    return new Set(linkedIds)
  }, [linkedInventory])

  useEffect(() => {
    setSelectedRows((prev) => {
      const next = { ...prev }
      let changed = false
      for (const rowId of Object.keys(prev)) {
        if (linkedItemIds.has(rowId)) {
          delete next[rowId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [linkedItemIds])

  const isLoading = isLoadingItems || isLoadingLinked
  const filterHelper = createDataTableFilterHelper<InventoryItem>()

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [filtering, setFiltering] = useState<DataTableFilteringState>({})
  const [search, setSearch] = useState("")

  const filteredItems = useMemo(() => {
    let result = inventory_items.filter((item) => {
      const itemId = getRowId(item)
      const isLinked = linkedItemIds.has(itemId)
      return item.raw_materials && !isLinked
    })

    if (search) {
      result = result.filter((item) => {
        const haystack = `${item.raw_materials?.name ?? ""} ${item.title ?? ""}`.toLowerCase()
        return haystack.includes(search.toLowerCase())
      })
    }

    result = result.filter((item) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true
        }

        const itemValue =
          key === "raw_materials.status"
            ? item.raw_materials?.status
            : key === "raw_materials.material_type.category"
            ? item.raw_materials?.material_type?.category
            : null

        if (Array.isArray(value)) {
          return value.some((v) => v === itemValue)
        }

        return itemValue === value
      })
    })

    return result
  }, [inventory_items, linkedItemIds, filtering, search])

  const handleRowSelect = useCallback(
    (row: InventoryItem) => {
      const rowId = getRowId(row)
      if (linkedItemIds.has(rowId)) {
        return
      }
      setSelectedRows((prev) => {
        if (prev[rowId]) {
          const { [rowId]: _, ...rest } = prev
          return rest
        }
        return {
          ...prev,
          [rowId]: createSelectionConfig(row),
        }
      })
    },
    [linkedItemIds]
  )

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedRows((prev) => {
        if (checked) {
          const next = { ...prev }
          filteredItems.forEach((item) => {
            const rowId = getRowId(item)
            if (!linkedItemIds.has(rowId) && !next[rowId]) {
              next[rowId] = createSelectionConfig(item)
            }
          })
          return next
        }

        const next = { ...prev }
        filteredItems.forEach((item) => {
          const rowId = getRowId(item)
          if (next[rowId]) {
            delete next[rowId]
          }
        })
        return next
      })
    },
    [filteredItems, linkedItemIds]
  )

  const paginatedItems = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize
    const end = start + pagination.pageSize
    return filteredItems.slice(start, end)
  }, [filteredItems, pagination])

  const columns = useInventoryColumns({
    filteredItems,
    handleRowSelect,
    handleSelectAll,
    linkedItemIds,
    selectedRows,
  })

  const table = useDataTable({
    columns,
    data: paginatedItems,
    getRowId: getRowId,
    rowCount: filteredItems.length,
    onRowClick: (_, row) => handleRowSelect(row),
    isLoading,
    filters: [
      filterHelper.accessor("raw_materials.status", {
        type: "select",
        label: "Status",
        options: [
          { label: "Active", value: "Active" },
          { label: "Discontinued", value: "Discontinued" },
          { label: "Under Review", value: "Under_Review" },
          { label: "Development", value: "Development" },
        ],
      }),
      filterHelper.accessor("raw_materials.material_type.category", {
        type: "select",
        label: "Category",
        options: [
          { label: "Fiber", value: "Fiber" },
          { label: "Yarn", value: "Yarn" },
          { label: "Fabric", value: "Fabric" },
          { label: "Trim", value: "Trim" },
          { label: "Dye", value: "Dye" },
          { label: "Chemical", value: "Chemical" },
          { label: "Accessory", value: "Accessory" },
          { label: "Other", value: "Other" },
        ],
      }),
    ],
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  })

  const selectedRowEntries = useMemo(() => Object.entries(selectedRows), [selectedRows])

  const selectedCount = selectedRowEntries.length

  const addInventoryToDesign = () => {
    if (!selectedCount) {
      return
    }

    const inventoryItemsPayload = selectedRowEntries.map(([, cfg]) => ({
      inventoryId: cfg.inventoryId,
      plannedQuantity: 1,
    }))

    linkInventory.mutate(
      { inventoryItems: inventoryItemsPayload },
      {
        onSuccess: () => {
          toast.success("Inventory items linked", {
            description: "Manage planned usage from the design inventory drawer.",
            action: {
              label: "Go to design",
              altText: "Navigate to design detail page",
              onClick: () => navigate(`/designs/${designId}`),
            },
          })
          setSelectedRows({})
        },
        onError: (error) => {
          console.error("Failed to link inventory items:", error)
          toast.error(error?.message || "Failed to link inventory items")
        },
      }
    )
  }

  const handleDelete = () => {
    console.log("Delete selected items", Object.keys(selectedRows))
  }

  const handleEdit = () => {
    console.log("Edit selected items", Object.keys(selectedRows))
  }

  const handleMoveUp = () => {
    console.log("Move items up", Object.keys(selectedRows))
  }

  const handleMoveDown = () => {
    console.log("Move items down", Object.keys(selectedRows))
  }

  useEffect(() => {
    const hasSelections = selectedCount > 0
    setIsCommandBarOpen(hasSelections)

    if (prevSelectedCount.current === 0 && selectedCount > 0) {
      toast.info("Adjust planned usage on the design", {
        description: "Linked items can be fine-tuned from the design inventory drawer.",
        action: {
          label: "Open design",
          altText: "Navigate to design detail page",
          onClick: () => navigate(`/designs/${designId}`),
        },
      })
    }

    prevSelectedCount.current = selectedCount
  }, [selectedCount, navigate, designId])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCommandBarOpen) {
        setSelectedRows({})
        setIsCommandBarOpen(false)
        event.preventDefault()
      }
    }

    if (isCommandBarOpen) {
      window.addEventListener("keydown", handler)
    }

    return () => {
      window.removeEventListener("keydown", handler)
    }
  }, [isCommandBarOpen])

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Command action={addInventoryToDesign} label="Link to Design" shortcut="a" />
          <CommandBar.Seperator />
          <CommandBar.Command action={handleDelete} label="Delete" shortcut="d" />
          <CommandBar.Seperator />
          <CommandBar.Command action={handleEdit} label="Edit" shortcut="e" />
          <CommandBar.Seperator />
          <CommandBar.Command action={handleMoveUp} label="Move Up" shortcut="↑" />
          <CommandBar.Command action={handleMoveDown} label="Move Down" shortcut="↓" />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex items-center justify-between">
          <div>
            <Heading>Inventory Items</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              All inventory items available for this design
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter inventory items" />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </RouteFocusModal>
  )
}
