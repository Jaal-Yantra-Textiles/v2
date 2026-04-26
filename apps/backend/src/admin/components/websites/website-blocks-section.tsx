import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState, CommandBar, toast } from "@medusajs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ActionMenu } from "../common/action-menu";
import { Plus } from "@medusajs/icons";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { AdminBlock, useBlocks } from "../../hooks/api/blocks";
import { useBlocksColumns } from "./hooks/use-blocks-columns";

interface WebsiteBlocksSectionProps {
  websiteId: string;
  pageId: string;
}

export function WebsiteBlocksSection({ websiteId, pageId }: WebsiteBlocksSectionProps) {
  if (!websiteId) return null;

  const navigate = useNavigate();

  const { blocks, isLoading } = useBlocks(websiteId, pageId);
  

  // Get the base columns from the hook
  const baseColumns = useBlocksColumns();
  
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

  const filterHelper = createDataTableFilterHelper<AdminBlock>();

  const filters = [
    filterHelper.accessor("type", {
      type: "select",
      label: "Block Type",
      options: [
        { label: "Hero", value: "Hero" },
        { label: "Header", value: "Header" },
        { label: "Footer", value: "Footer" },
        { label: "Feature", value: "Feature" },
        { label: "Gallery", value: "Gallery" },
        { label: "Testimonial", value: "Testimonial" },
        { label: "MainContent", value: "MainContent" },
      ],
    }),
  ];

  // Define filtered blocks before using it in the columns definition
  const filteredBlocks = useMemo(() => {
    let result = blocks || [];

    // Apply search first
    if (search) {
      result = result.filter((block) => 
        block.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Then apply filters
    result = result.filter((block) => {
      return Object.entries(filtering).every(([key, value]) => {
        if (!value) {
          return true;
        }
        
        // Get the actual value from the block
        const blockValue = block[key as keyof typeof block];

        // For type, do exact match
        if (key === 'type') {
          if (Array.isArray(value)) {
            return value.some(v => v === blockValue);
          }
          return blockValue === value;
        }

        // For other string values, do includes match
        if (typeof value === 'string') {
          return blockValue?.toString().toLowerCase().includes(value.toString().toLowerCase());
        }

        return true;
      });
    });

    return result;
  }, [blocks, filtering, search]);
  
  // Add a selection column with checkbox
  const columns = useMemo(() => {
    const selectionColumn = {
      id: 'select',
      header: ({ table }: any) => (
        <input
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={(e) => {
            table.toggleAllRowsSelected(e.target.checked);
            // Select or deselect all rows
            if (e.target.checked) {
              const allSelected = filteredBlocks.reduce((acc, block) => {
                acc[block.id] = true;
                return acc;
              }, {} as Record<string, boolean>);
              setSelectedRows(allSelected);
            } else {
              setSelectedRows({});
            }
          }}
        />
      ),
      cell: ({ row }: any) => (
        <input
          type="checkbox"
          checked={selectedRows[row.id] || false}
          onChange={(e) => {
            row.toggleSelected(e.target.checked);
            // Update selected rows
            setSelectedRows(prev => {
              const newState = { ...prev };
              if (e.target.checked) {
                newState[row.id] = true;
              } else {
                delete newState[row.id];
              }
              return newState;
            });
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 40,
    };
    
    return [selectionColumn, ...baseColumns];
  }, [baseColumns, selectedRows, filteredBlocks]);

  // Pagination calculation
  const paginatedBlocks = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredBlocks.slice(start, end);
  }, [filteredBlocks, pagination]);



  // Handle row selection changes
  const handleRowSelectionChange = (newSelection: Record<string, boolean>) => {
    setSelectedRows(newSelection);
  };
  
  // Update command bar visibility when selections change
  useEffect(() => {
    const hasSelections = Object.keys(selectedRows).length > 0;
    setIsCommandBarOpen(hasSelections);
  }, [selectedRows]);

  // Handle escape key to clear selection
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isCommandBarOpen) {
        // Clear all selections
        setSelectedRows({});
        setIsCommandBarOpen(false);
        event.preventDefault();
      }
    };

    if (isCommandBarOpen) {
      window.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isCommandBarOpen]);

  // Get the count of selected rows
  const selectedCount = Object.keys(selectedRows).length;

  // Create a single delete mutation that can be used for any block
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: async (blockId: string) => {
      return await fetch(`/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blocks"] });
      queryClient.invalidateQueries({ queryKey: ["pages", pageId] });
    },
  });
  
  // Handle delete action
  const handleDelete = async () => {
    const selectedIds = Object.keys(selectedRows);
    let successCount = 0;
    let errorCount = 0;

    for (const blockId of selectedIds) {
      try {
        await deleteMutation.mutateAsync(blockId);
        successCount++;
      } catch (error) {
        console.error(`Failed to delete block ${blockId}:`, error);
        errorCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Successfully deleted ${successCount} block${successCount !== 1 ? 's' : ''}`);
    }
    
    if (errorCount > 0) {
      toast.error(`Failed to delete ${errorCount} block${errorCount !== 1 ? 's' : ''}`);
    }

    // Clear selection after delete
    setSelectedRows({});
    setIsCommandBarOpen(false);
  };

  // Handle edit action
  const handleEdit = () => {
    const selectedIds = Object.keys(selectedRows);
    if (selectedIds.length === 1) {
      navigate(`/websites/${websiteId}/pages/${pageId}/blocks/${selectedIds[0]}`);
    }
  };

  const table = useDataTable({
    columns,
    data: paginatedBlocks,
    getRowId: (row) => row.id,
    rowSelection: {
      state: selectedRows,
      onRowSelectionChange: handleRowSelectionChange,
      enableRowSelection: true
    },
    onRowClick: (_, row) => {
      navigate(`/websites/${websiteId}/pages/${pageId}/blocks/${row.id}`);
    },
    rowCount: filteredBlocks.length,
    isLoading,
    filters,
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
  });

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center">
          <div>
            <Heading>Blocks</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              All blocks associated with this page
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search />
            <DataTable.FilterMenu tooltip="Filter blocks" />
            <ActionMenu groups={[{
              actions: [{
                label: 'Add Block',
                icon: <Plus />,
                to: `/websites/${websiteId}/pages/${pageId}/blocks/new`,
              }],
            }]} />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>

      <CommandBar open={isCommandBarOpen}>
        <CommandBar.Bar>
          <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
          <CommandBar.Command
            action={handleEdit}
            label="Edit"
            shortcut="e"
            disabled={selectedCount !== 1}
          />
          <CommandBar.Seperator />
          <CommandBar.Command
            action={handleDelete}
            label="Delete"
            shortcut="d"
          />
        </CommandBar.Bar>
      </CommandBar>
    </Container>
  );
}
