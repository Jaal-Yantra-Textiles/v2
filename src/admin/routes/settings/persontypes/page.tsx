import { Container, Heading, Text } from "@medusajs/ui";
import { keepPreviousData } from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { DocumentSeries, PencilSquare, Trash } from "@medusajs/icons";
import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { AdminPersonType } from "@medusajs/framework/types";
import { usePersonTypeTableColumns } from "../../../hooks/columns/usePersonTypeTableColumns";
import { EntityActions } from "../../../components/persons/personsActions";
import { usePersonTypeTableQuery } from "../../../hooks/queries/persontype/usePersonTypeTableQuery";
import { usePersonTypes } from "../../../hooks/api/persontype";
import { useDataTable } from "../../../hooks/usedataTable";
import CreateButton from "../../../components/creates/create-button";
import { DataTable } from "../../../components/table/data-table";
import { useDeletePersonTypeAction } from "../../../hooks/delete/useDeletePersonTypes";

const columnHelper = createColumnHelper<AdminPersonType>();

const ActionCell = ({ row }: { row: { original: AdminPersonType } }) => {
  const handleDelete = useDeletePersonTypeAction(row.original.id);

  const personActionsConfig = useMemo(
    () => ({
      actions: [
        {
          icon: <PencilSquare />,
          label: "Edit",
          to: (personType: AdminPersonType) =>
            `/settings/persontypes/${personType.id}/edit`,
        },
        {
          icon: <Trash />,
          label: "Delete",
          onClick: () => handleDelete(),
        },
      ],
    }),
    [handleDelete],
  );

  return (
    <EntityActions entity={row.original} actionsConfig={personActionsConfig} />
  );
};

export const useColumns = () => {
  const columns = usePersonTypeTableColumns();

  return useMemo(
    () => [
      ...columns,
      columnHelper.display({
        id: "actions",
        cell: ActionCell,
      }),
    ],
    [columns],
  );
};

const PersonTypePage = () => {
  const { searchParams, raw } = usePersonTypeTableQuery({ pageSize: 20 });
  const { personTypes, count, isLoading, isError, error } = usePersonTypes(
    {
      ...searchParams,
    },
    {
      placeholderData: keepPreviousData,
    },
  );

  const columns = useColumns();

  const { table } = useDataTable({
    data: personTypes,
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
          <Heading>Person Types</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Define your categories and types here for persons
          </Text>
        </div>
        <CreateButton />
      </div>
      <DataTable
        table={table}
        columns={columns}
        pageSize={10}
        count={count}
        orderBy={[{ key: "name", label: "Name" }]}
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

export default PersonTypePage;

export const config = defineRouteConfig({
  label: "Person Types",
  icon: DocumentSeries,
});
