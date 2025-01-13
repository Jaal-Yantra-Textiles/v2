import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ToolsSolid, PencilSquare } from "@medusajs/icons";
import CreateButton from "../../components/creates/create-button";
import { usePersons } from "../../hooks/api/persons";
import { useMemo } from "react";
import { DataTable } from "../../components/table/data-table";
import { useDataTable } from "../../hooks/usedataTable";
import { usePersonsTableQuery } from "../../hooks/usePersontableQuery";
import { usePersonTableFilters } from "../../hooks/filters/usePersonsTablefilters";
import { usePersonTableColumns } from "../../hooks/columns/usePersonTableColumns";
import { EntityActions } from "../../components/persons/personsActions";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminPerson } from "@medusajs/framework/types";

const columnHelper = createColumnHelper<AdminPerson>();
export const useColumns = () => {
  const columns = usePersonTableColumns();

  const personActionsConfig = {
    actions: [
      {
        icon: <PencilSquare />,
        label: "Edit",
        to: (personType: AdminPerson) => `/persontype/${personType.id}/edit`,
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
            actionsConfig={personActionsConfig}
          />
        ),
      }),
    ],
    [columns],
  );
};

const PersonsPage = () => {
  const { searchParams, raw } = usePersonsTableQuery({ pageSize: 10 });

  const {
    persons, // Access the persons array directly
    count, // Access the count directly
    isLoading,
    isError,
    error,
  } = usePersons(
    {
      ...searchParams,
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const filters = usePersonTableFilters();
  const columns = useColumns();

  const { table } = useDataTable({
    data: persons ?? [],
    columns,
    count,
    enablePagination: true,
    getRowId: (row) => row.id,
    pageSize: 10,
  });

  if (isError) {
    throw error;
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Persons</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage all your relationships from here
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
        orderBy={[{ key: "email", label: "Email" }]}
        isLoading={isLoading}
        navigateTo={(row) => row.original.id}
        search
        queryObject={raw}
        noRecords={{
          message: "Oh no records found",
        }}
      />
    </Container>
  );
};

export default PersonsPage;

export const config = defineRouteConfig({
  label: "Designs",
  icon: ToolsSolid,
});
