import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";

import { ActionMenu } from "../common/action-menu";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
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
  

  const columns = useBlocksColumns();

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

  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");

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

  const paginatedBlocks = useMemo(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredBlocks.slice(start, end);
  }, [filteredBlocks, pagination]);

  const table = useDataTable({
    columns,
    data: paginatedBlocks,
    getRowId: (row) => row.id,
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
                onClick: () => navigate(`/websites/${websiteId}/pages/${pageId}/blocks/new`),
              }],
            }]} />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
  );
}
