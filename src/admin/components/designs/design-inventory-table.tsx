import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, Checkbox, CommandBar, Tooltip } from "@medusajs/ui";
import { useInventoryItems, InventoryItem } from "../../hooks/api/raw-materials";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "@medusajs/icons";
import { useInventoryColumns } from "./hooks/use-inventory-columns";
import { useCallback, useMemo, useState, useEffect } from "react";
import { useLinkDesignInventory, useDesignInventory } from "../../hooks/api/designs";
import { toast } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";


interface DesignInventoryTableProps {
  designId: string;
}

export function DesignInventoryTable({ designId }: DesignInventoryTableProps) {
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);

  const handleDelete = () => {
    // Implement delete functionality for selected items
    console.log('Delete selected items', Object.keys(selectedRows));
  };

  const handleEdit = () => {
    // Implement edit functionality for selected items
    console.log('Edit selected items', Object.keys(selectedRows));
  };

  const handleMoveUp = () => {
    // Implement move up functionality
    console.log('Move items up', Object.keys(selectedRows));
  };

  const handleMoveDown = () => {
    // Implement move down functionality
    console.log('Move items down', Object.keys(selectedRows));
  };

  const linkInventory = useLinkDesignInventory(designId);

  const addInventoryToDesign = () => {
    const selectedItemIds = Object.keys(selectedRows);
    if (selectedItemIds.length === 0) return;

    linkInventory.mutate(
      { inventoryIds: selectedItemIds },
      {
        onSuccess: () => {
          // Clear selections after successful linking
          toast.success("Inventory items linked successfully");
          setSelectedRows({});
        },
        onError: (error) => {
          console.error("Failed to link inventory items:", error);
          // You might want to show a notification here
          toast.error("Failed to link inventory items");
        },
      }
    );
  }
  // Fetch linked inventory items
  const { data: linkedInventory, isLoading: isLoadingLinked } = useDesignInventory(designId);
  
  
  // Create a Set of just the IDs from linked inventory items
  const linkedItemIds = useMemo(() => {
    if (!linkedInventory?.inventory_items || !Array.isArray(linkedInventory.inventory_items)) {
      return new Set<string>();
    }
    
    // Define a type for the inventory item that can be either a string or an object with an id
    type InventoryItemOrId = string | { id: string; [key: string]: any };
    
    // Extract just the IDs from the inventory items
    return new Set(
      linkedInventory.inventory_items.map((item: InventoryItemOrId) => 
        typeof item === 'string' ? item : item.id
      )
    );
  }, [linkedInventory]);

  

  const { inventory_items = [], isLoading: isLoadingItems } = useInventoryItems({
    fields: "+raw_materials.*, +raw_materials.material_type.*"
  });
  
  const filterHelper = createDataTableFilterHelper<InventoryItem>();

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

  const filteredItems = useMemo(() => {
    // First filter out items without raw_materials
    let result = inventory_items.filter(item => item.raw_materials);

    // Apply search
    if (search) {
      result = result.filter((item) => 
        (item.raw_materials?.name?.toLowerCase().includes(search.toLowerCase()) || 
         item.title?.toLowerCase().includes(search.toLowerCase()))
      )
    }

    // Then apply filters
    result = result.filter((item) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true
        }
        
        // Get the actual value based on the key
        const itemValue = key === 'raw_materials.status'
          ? item.raw_materials?.status
          : key === 'raw_materials.material_type.category'
          ? item.raw_materials?.material_type?.category
          : null;

        if (Array.isArray(value)) {
          return value.some(v => v === itemValue)
        }

        return itemValue === value
      })
    })

    return result;
  }, [inventory_items, filtering, search]);

  const handleRowSelect = useCallback((rowId: string) => {
    // Don't allow selecting linked items
    if (linkedItemIds.has(rowId)) return;

    setSelectedRows(prev => {
      const newState = { ...prev };
      if (newState[rowId]) {
        delete newState[rowId];
      } else {
        newState[rowId] = true;
      }
      return newState;
    });
  }, [linkedItemIds]);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allSelected = filteredItems.reduce((acc, item) => {
        // Don't select linked items
        if (!linkedItemIds.has(item.id)) {
          acc[item.id] = true;
        }
        return acc;
      }, {} as Record<string, boolean>);
      setSelectedRows(allSelected);
    } else {
      setSelectedRows({});
    }
  }, [filteredItems, linkedItemIds]);

  const isLoading = isLoadingItems || isLoadingLinked;

  const columns = useInventoryColumns({
    linkedItemIds,
    selectedRows,
    handleSelectAll,
    handleRowSelect,
    filteredItems,
  });

  const filters = [
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
  ];

  const paginatedItems = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredItems.slice(start, end);
  }, [filteredItems, pagination]);

  const table = useDataTable({
    columns: columns,
    data: paginatedItems,
    getRowId: (row) => row.id,
    rowCount: filteredItems.length,
    onRowClick: (_, row) => {
      // Only handle selection for non-linked items
      const rowId = row.id as string;
      
      // Check if the item is in the linkedItemIds Set
      if (!linkedItemIds.has(rowId)) {
        handleRowSelect(rowId);
      }
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
  });

  // Add styling for linked items
  useEffect(() => {
    // Add a style element for linked inventory items
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .linked-inventory {
        background-color: #f8f9fa !important;
      }
      .linked-inventory:hover {
        background-color: #f8f9fa !important;
      }
    `;
    document.head.appendChild(styleEl);
    
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  // Update command bar visibility when selections change
  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0;
    setIsCommandBarOpen(hasSelections);
  }, [selectedRows]);

  // Add escape key handler to clear selections
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        // Clear all selections
        setSelectedRows({});
        setIsCommandBarOpen(false);
        
        // Prevent default behavior to avoid conflicts with other handlers
        event.preventDefault();
      }
    };

    // Add the event listener when the command bar is open
    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey);
    }
    
    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isCommandBarOpen]);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header></RouteFocusModal.Header>
    <Container className="divide-y p-0">
      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{Object.keys(selectedRows).length} selected</CommandBar.Value>
          <CommandBar.Command
            action={addInventoryToDesign}
            label="Add to Design"
            shortcut="a"
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleDelete}
            label="Delete"
            shortcut="d"
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleEdit}
            label="Edit"
            shortcut="e"
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleMoveUp}
            label="Move Up"
            shortcut="↑"
          />
          <CommandBar.Command
            action={handleMoveDown}
            label="Move Down"
            shortcut="↓"
          />
        </CommandBar.Bar>
      </CommandBar>
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Inventory Items</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              All inventory items available for this design
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter inventory items" />
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      label: "Add Inventory",
                      icon: <Plus />,
                      to: `/designs/${designId}/addinv`,
                    },
                  ],
                },
              ]}
            />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
    </RouteFocusModal>
  );
}
