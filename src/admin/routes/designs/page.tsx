import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { useMemo } from "react";
import { DataTable } from "../../components/table/data-table";
import { useDataTable } from "../../hooks/usedataTable";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { useDesignsTableQuery } from "../../hooks/queries/designs/useDesignsTableQuery";
import { AdminDesign, useDesigns } from "../../hooks/api/designs";
import { useDesignsTableFilters } from "../../hooks/filters/useDesignsTableFilters";
import { useDesignsTableColumns } from "../../hooks/columns/useDesignsTableColumns";
import { Outlet } from "react-router-dom"
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
  const { searchParams, raw } = useDesignsTableQuery({ pageSize: 10 });

  const {
    designs, 
    count, // Access the count directly
    isLoading,
    isError,
    error,
  } = useDesigns(
    {
      ...searchParams,
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const filters = useDesignsTableFilters();
  const columns = useColumns();

  const { table } = useDataTable({
    data: designs ?? [],
    columns,
    count,
    enablePagination: true,
    getRowId: (row) => row.id as string,
    pageSize: 10,
  });

  if (isError) {
    throw error;
  }

  return (
    <div>
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Designs</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage all your designs from here
          </Text>
        </div>
        <CreateButton />
      </div>
      <DataTable
        table={table}
        columns={columns}
        pageSize={10}
        count={count}
        filters={filters}
        orderBy={[{ key: "design_type", label: "Design Type" }, {key: "priority", label: "Priority"}, {key: "status", label: "Status"}]}
        isLoading={isLoading}
        navigateTo={(row) => row.original.id as string}
        search
        queryObject={raw}
        noRecords={{
          message: "Oh no records found",
        }}
      />
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