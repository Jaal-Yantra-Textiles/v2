import { Container, Heading, Text, DataTable, useDataTable, createDataTableFilterHelper, DataTablePaginationState, DataTableFilteringState } from "@medusajs/ui";
import { useNavigate } from "react-router-dom";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { useMemo, useState } from "react";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminDesign, useDesigns } from "../../hooks/api/designs";
import { useDesignsTableColumns } from "../../hooks/columns/useDesignsTableColumns";
import { AdminDesignsQuery } from "../../hooks/api/designs";

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
      onSearchChange: setSearch,
    },
    filtering: {
      state: filtering,
      onFilteringChange: setFiltering,
    },
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex justify-between items-center px-6 py-4">
          <div>
            <Heading>Designs</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Manage all your designs from here
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <DataTable.Search placeholder="Search designs..." />
            <DataTable.FilterMenu tooltip="Filter designs" />
            <CreateButton />
          </div>
        </DataTable.Toolbar>
        <DataTable.Table />
        <DataTable.Pagination />
      </DataTable>
    </Container>
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