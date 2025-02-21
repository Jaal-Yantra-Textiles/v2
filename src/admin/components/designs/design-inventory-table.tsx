import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, Checkbox } from "@medusajs/ui";
import { useInventoryItems, InventoryItem } from "../../hooks/api/raw-materials";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "@medusajs/icons";
import { useInventoryColumns } from "./hooks/use-inventory-columns";
import { useCallback, useMemo, useState } from "react";


interface DesignInventoryTableProps {
  designId: string;
}

export function DesignInventoryTable({ designId }: DesignInventoryTableProps) {
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const { inventory_items = [], isLoading } = useInventoryItems({
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
    setSelectedRows(prev => {
      const newState = { ...prev };
      if (newState[rowId]) {
        delete newState[rowId];
      } else {
        newState[rowId] = true;
      }
      return newState;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allSelected = filteredItems.reduce((acc, item) => {
        acc[item.id] = true;
        return acc;
      }, {} as Record<string, boolean>);
      setSelectedRows(allSelected);
    } else {
      setSelectedRows({});
    }
  }, [filteredItems]);

  const columns = useInventoryColumns({
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
     // navigate(`/designs/${designId}/inventory/${row.id}`);
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

  return (
    <Container className="divide-y p-0">
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
  );
}
