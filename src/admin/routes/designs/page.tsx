import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { Outlet, useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { useMemo, useState, useCallback } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminDesign, useDesigns } from "../../hooks/api/designs";
import { useDesignsTableColumns } from "../../hooks/columns/useDesignsTableColumns";
import { AdminDesignsQuery } from "../../hooks/api/designs";
import debounce from "lodash/debounce";

const columnHelper = createColumnHelper<AdminDesign>();
export const useColumns = () => {
  const columns = useDesignsTableColumns();

  const designActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (design: AdminDesign) => `/designs/${design.id}/edit`,
      },
      // Add more actions as needed
    ],
  };

  return useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ({ row }) => (
          <EntityActions
            entity={row.original}
            actionsConfig={designActionsConfig}
          />
        ),
      }),
    ],
    [columns],
  );
};

const DesignsPage = () => {
  const navigate = useNavigate();
  
  const [pagination, setPagination] = useState<DataTablePaginationState>({
    pageSize: 10,
    pageIndex: 0,
  });
  const [filtering, setFiltering] = useState<DataTableFilteringState>({});
  const [search, setSearch] = useState<string>("");
  
  // Debounced filter change handler to prevent rapid re-renders and API calls
  const handleFilterChange = useCallback(
    debounce((newFilters: DataTableFilteringState) => {
      setFiltering(newFilters);
    }, 300),
    []
  );

  // Debounced search change handler
  const handleSearchChange = useCallback(
    debounce((newSearch: string) => {
      setSearch(newSearch);
    }, 300),
    []
  );
  
  // Calculate the offset based on pagination
  const offset = pagination.pageIndex * pagination.pageSize;
  
  const {
    designs, 
    count,
    isLoading,
    isError,
    error,
  } = useDesigns(
    {
      limit: pagination.pageSize,
      offset: offset,
      name: search || undefined, // Use name instead of q for search
      // Apply filtering only for known fields
      ...(Object.keys(filtering).length > 0 ? 
        Object.entries(filtering).reduce((acc, [key, value]) => {
          // Only add keys that exist in AdminDesignsQuery
          if (key === 'design_type') {
            acc.design_type = value as AdminDesign['design_type'];
          } else if (key === 'status') {
            acc.status = value as AdminDesign['status'];
          } else if (key === 'priority') {
            acc.priority = value as AdminDesign['priority'];
          } else if (key === 'tags') {
            // Handle tags as string array
            acc.tags = Array.isArray(value) ? value : [value as string];
          }
          return acc;
        }, {} as AdminDesignsQuery) : {}),
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();
  
  const filterHelper = createDataTableFilterHelper<AdminDesign>();
  
  // Create filters using the filterHelper
  const filters = [
    filterHelper.accessor("design_type", {
      type: "select",
      label: "Design Type",
      options: [
        { label: "Original", value: "Original" },
        { label: "Derivative", value: "Derivative" },
        { label: "Custom", value: "Custom" },
        { label: "Collaboration", value: "Collaboration" },
      ],
    }),
    filterHelper.accessor("status", {
      type: "select",
      label: "Status",
      options: [
        { label: "Conceptual", value: "Conceptual" },
        { label: "In Development", value: "In_Development" },
        { label: "Technical Review", value: "Technical_Review" },
        { label: "Sample Production", value: "Sample_Production" },
        { label: "Revision", value: "Revision" },
        { label: "Approved", value: "Approved" },
        { label: "Rejected", value: "Rejected" },
        { label: "On Hold", value: "On_Hold" },
      ],
    }),
    filterHelper.accessor("priority", {
      type: "select",
      label: "Priority",
      options: [
        { label: "Low", value: "Low" },
        { label: "Medium", value: "Medium" },
        { label: "High", value: "High" },
        { label: "Urgent", value: "Urgent" },
      ],
    }),
    filterHelper.accessor("tags", {
      type: "select",
      label: "Tags",
      options: useMemo(() => {
        if (!designs?.length) return [];
        
        // Extract all tags from all designs
        const allTags = designs.reduce((acc: string[], design) => {
          if (design.tags?.length) {
            return [...acc, ...design.tags];
          }
          return acc;
        }, []);
        
        // Create unique tag list
        const uniqueTags = [...new Set(allTags)];
        
        // Convert to options format
        return uniqueTags.map(tag => ({
          label: tag,
          value: tag
        }));
      }, [designs]),
    }),
  ];

  const table = useDataTable({
    columns,
    data: designs ?? [],
    getRowId: (row) => row.id as string,
    onRowClick: (_, row) => {
      navigate(`/designs/${row.id}`);
    },
    rowCount: count,
    isLoading,
    filters,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: handleSearchChange,
    },
    filtering: {
      state: filtering,
      onFilteringChange: handleFilterChange,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-col md:flex-row justify-between gap-y-4 px-6 py-4">
          <div>
            <Heading>Designs</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your designs from here
            </Text>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-y-2 gap-x-2">
            <div className="w-full sm:max-w-[260px] md:w-auto">
              <DataTable.Search placeholder="Search designs..." />
            </div>
            <div className="flex items-center gap-x-2">
              <DataTable.FilterMenu tooltip="Filter designs" />
              <CreateButton />
            </div>
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
    <Outlet></Outlet>
    </div>
  );
};

export default DesignsPage;

export const config = defineRouteConfig({
  label: "Designs",
  icon: ToolsSolid,
});


export const handle = {
  breadcrumb: () => "Designs",
};